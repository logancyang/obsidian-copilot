import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { logInfo, logWarn, logError } from "@/logger";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BedrockChatModelCallOptions extends BaseChatModelCallOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface BedrockChatModelFields extends BaseChatModelParams {
  modelId: string;
  modelName?: string; // Passed to BaseChatModel via baseParams
  apiKey: string;
  endpoint: string;
  streamEndpoint?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  defaultTopP?: number;
  anthropicVersion?: string;
  fetchImplementation?: FetchImplementation;
  streaming?: boolean;
}

/**
 * Lightweight ChatModel integration for Amazon Bedrock using a simple API key header.
 * This implementation issues JSON requests against the public Bedrock runtime endpoint.
 */
export class BedrockChatModel extends BaseChatModel<BedrockChatModelCallOptions> {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly streamEndpoint?: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly defaultMaxTokens?: number;
  private readonly defaultTemperature?: number;
  private readonly defaultTopP?: number;
  private readonly anthropicVersion?: string;

  constructor(fields: BedrockChatModelFields) {
    const {
      modelId,
      apiKey,
      endpoint,
      streamEndpoint,
      defaultMaxTokens,
      defaultTemperature,
      defaultTopP,
      anthropicVersion,
      fetchImplementation,
      ...baseParams
    } = fields;

    if (!modelId) {
      throw new Error("Amazon Bedrock model identifier is required.");
    }
    if (!apiKey) {
      throw new Error("Amazon Bedrock API key is required.");
    }
    if (!endpoint) {
      throw new Error("Amazon Bedrock endpoint is required.");
    }

    super(baseParams);

    const globalFetch = typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined;

    this.fetchImpl = fetchImplementation ?? globalFetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available for Amazon Bedrock requests.");
    }

    if ((baseParams as { streaming?: boolean }).streaming && !streamEndpoint) {
      logWarn(
        "Amazon Bedrock streaming requested without a streaming endpoint; falling back to non-streaming mode."
      );
    }

    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.streamEndpoint = streamEndpoint;
    this.defaultMaxTokens = defaultMaxTokens;
    this.defaultTemperature = defaultTemperature;
    this.defaultTopP = defaultTopP;
    this.anthropicVersion = anthropicVersion;
  }

  _llmType(): string {
    return "amazon-bedrock";
  }

  async _generate(
    messages: BaseMessage[],
    options?: BedrockChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const requestBody = this.buildRequestBody(messages, options);

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Amazon Bedrock request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = this.extractText(data);

    if (runManager && text) {
      await runManager.handleLLMNewToken(text);
    }

    const usage = this.extractUsage(data);
    const usageMetadata = usage ? this.normaliseUsageMetadata(usage) : undefined;

    const responseMetadata = {
      stopReason: data.stop_reason ?? data.stopReason,
      usage,
      rawResponse: data,
    };

    const aiMessage = new AIMessage({
      content: text,
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
    });

    const generation: ChatGeneration = {
      message: aiMessage,
      text,
      generationInfo: responseMetadata,
    };

    return {
      generations: [generation],
      llmOutput: responseMetadata,
    };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: BedrockChatModelCallOptions = {},
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    if (!this.streamEndpoint) {
      const result = await this._generate(messages, options, runManager);
      const text = result.generations[0]?.text ?? "";
      if (!text) {
        return;
      }

      const messageChunk = new AIMessageChunk({
        content: text,
        response_metadata: result.llmOutput ?? {},
      });

      yield new ChatGenerationChunk({
        message: messageChunk,
        text,
        generationInfo: result.llmOutput ?? {},
      });
      return;
    }

    const requestBody = this.buildRequestBody(messages, options);
    const requestId = `bedrock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    logInfo(`[${requestId}] Starting Bedrock stream request to ${this.streamEndpoint}`);

    const response = await this.fetchImpl(this.streamEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Amazon Bedrock streaming request failed with status ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("Amazon Bedrock streaming response did not include a readable body.");
    }

    const reader = response.body.getReader();

    let byteBuffer = new Uint8Array(0);
    let stopReason: string | undefined;
    let usage: Record<string, unknown> | undefined;
    let hasYielded = false;
    const debugEvents: string[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        // Append new bytes to buffer
        const newBuffer = new Uint8Array(byteBuffer.length + value.length);
        newBuffer.set(byteBuffer);
        newBuffer.set(value, byteBuffer.length);
        byteBuffer = newBuffer;

        // Try to parse EventStream messages from buffer
        const { messages, remainingBytes } = this.parseEventStreamBuffer(byteBuffer);
        byteBuffer = new Uint8Array(remainingBytes);

        for (const messagePayload of messages) {
          const outerEvent = this.safeJsonParse(messagePayload);
          if (!outerEvent) {
            logWarn(
              `[${requestId}] Failed to parse event JSON: ${messagePayload.slice(0, 100)}...`
            );
            continue;
          }

          // Handle AWS EventStream format where bytes field is at top level
          let eventToProcess = outerEvent;
          if (typeof outerEvent.bytes === "string" && !outerEvent.type) {
            // Wrap it in the expected structure
            eventToProcess = {
              type: "chunk",
              chunk: { bytes: outerEvent.bytes },
            };
          }

          const processed = await this.processStreamEvent(
            eventToProcess,
            runManager,
            usage,
            stopReason
          );

          usage = processed.usage ?? usage;
          stopReason = processed.stopReason ?? stopReason;

          if (!processed.hasText) {
            debugEvents.push(this.describeEvent(outerEvent));
          }

          if (processed.deltaChunks.length > 0) {
            for (const chunk of processed.deltaChunks) {
              hasYielded = hasYielded || Boolean(chunk.text);
              yield chunk;
            }
          }

          if (processed.debugSummaries.length > 0) {
            debugEvents.push(...processed.debugSummaries);
          }
        }
      }
    } catch (error) {
      logError(
        `[${requestId}] Error during stream processing: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (usage || stopReason) {
      yield this.buildTerminalMetadataChunk(stopReason, usage);
    }

    if (!hasYielded) {
      logWarn(
        `[${requestId}] Stream complete but no text yielded. Usage: ${JSON.stringify(usage)}, stopReason: ${stopReason}`
      );
      if (debugEvents.length > 0) {
        logInfo(
          `[${requestId}] Amazon Bedrock streaming produced no delta text. Sample events: ${debugEvents
            .slice(0, 5)
            .join(" | ")}`
        );
      }
      logWarn(
        `[${requestId}] Amazon Bedrock streaming returned no content. Falling back to non-streaming response.`
      );
      const fallback = await this._generate(messages, options, runManager);
      const fallbackText = fallback.generations[0]?.text ?? "";
      if (fallbackText) {
        yield new ChatGenerationChunk({
          message: new AIMessageChunk({
            content: fallbackText,
            response_metadata: fallback.llmOutput ?? {},
          }),
          text: fallbackText,
          generationInfo: fallback.llmOutput ?? {},
        });
      }
    }
  }

  private safeJsonParse(value: string): any | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private async processStreamEvent(
    event: any,
    runManager: CallbackManagerForLLMRun | undefined,
    currentUsage?: Record<string, unknown>,
    currentStopReason?: string
  ): Promise<{
    deltaChunks: ChatGenerationChunk[];
    usage?: Record<string, unknown>;
    stopReason?: string;
    hasText: boolean;
    debugSummaries: string[];
  }> {
    const deltaChunks: ChatGenerationChunk[] = [];
    let usage = currentUsage;
    let stopReason = currentStopReason;
    let hasText = false;
    const debugSummaries: string[] = [];

    if (event?.type === "chunk" && typeof event.chunk?.bytes === "string") {
      const decodedPayloads = this.decodeChunkBytes(event.chunk.bytes);

      for (const payload of decodedPayloads) {
        const innerEvent = this.safeJsonParse(payload);
        if (!innerEvent) {
          debugSummaries.push(`Failed to parse inner payload: ${this.describePayload(payload)}`);
          continue;
        }

        const chunkMetadata = this.buildChunkMetadata(innerEvent);
        const deltaText = this.extractStreamText(innerEvent);
        if (deltaText) {
          const messageChunk = new AIMessageChunk({
            content: deltaText,
            response_metadata: chunkMetadata,
          });

          const generationChunk = new ChatGenerationChunk({
            message: messageChunk,
            text: deltaText,
            generationInfo: chunkMetadata,
          });

          deltaChunks.push(generationChunk);
          hasText = true;
          if (runManager) {
            await runManager.handleLLMNewToken(deltaText);
          }
        } else {
          // Only log if it's an unexpected event type that should have had text
          if (innerEvent.type === "content_block_delta") {
            const summary = `No text in content_block_delta event: ${this.describeEvent(innerEvent)}`;
            debugSummaries.push(summary);
            logWarn(`processStreamEvent: ${summary}`);
          }
        }

        const innerUsage = this.extractUsage(innerEvent);
        if (innerUsage) {
          usage = innerUsage;
        }

        const innerStopReason = this.extractStopReason(innerEvent);
        if (innerStopReason) {
          stopReason = innerStopReason;
        }
      }
    } else {
      const chunkMetadata = this.buildChunkMetadata(event);
      const deltaText = this.extractStreamText(event);
      if (deltaText) {
        const messageChunk = new AIMessageChunk({
          content: deltaText,
          response_metadata: chunkMetadata,
        });
        const generationChunk = new ChatGenerationChunk({
          message: messageChunk,
          text: deltaText,
          generationInfo: chunkMetadata,
        });
        deltaChunks.push(generationChunk);
        hasText = true;
        if (runManager) {
          await runManager.handleLLMNewToken(deltaText);
        }
      }

      const outerUsage = this.extractUsage(event);
      if (outerUsage) {
        usage = outerUsage;
      }

      const outerStopReason = this.extractStopReason(event);
      if (outerStopReason) {
        stopReason = outerStopReason;
      }
    }

    return {
      deltaChunks,
      usage,
      stopReason,
      hasText,
      debugSummaries,
    };
  }

  private describeEvent(event: Record<string, unknown>): string {
    if (!event) {
      return "<empty event>";
    }

    const type = typeof event.type === "string" ? event.type : "unknown";
    const keys = Object.keys(event).slice(0, 6).join(",");
    const summary = this.stringifyForLog(event);
    return `${type} {${keys}} -> ${summary}`;
  }

  private describePayload(value: string): string {
    if (!value) {
      return "<empty payload>";
    }
    if (value.length <= 200) {
      return value;
    }
    return `${value.slice(0, 200)}… (len=${value.length})`;
  }

  private stringifyForLog(value: unknown): string {
    try {
      const sanitized = this.sanitiseForLog(value);
      const json = JSON.stringify(sanitized);
      if (!json) {
        return "<un-stringifiable>";
      }
      return json.length > 400 ? `${json.slice(0, 400)}… (len=${json.length})` : json;
    } catch {
      return "<failed to stringify>";
    }
  }

  private sanitiseForLog(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 5).map((item) => this.sanitiseForLog(item));
    }

    const record = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    const entries = Object.entries(record);
    for (let i = 0; i < entries.length && i < 10; i += 1) {
      const [key, entryValue] = entries[i];
      if (typeof entryValue === "string" && entryValue.length > 200) {
        if (key === "bytes" || key === "chunk" || key === "chunk_bytes") {
          copy[key] = `<base64 len=${entryValue.length}>`;
        } else {
          copy[key] = `${entryValue.slice(0, 200)}… (len=${entryValue.length})`;
        }
      } else {
        copy[key] = this.sanitiseForLog(entryValue);
      }
    }
    return copy;
  }

  private decodeChunkBytes(encoded: string): string[] {
    const bytes = this.decodeBase64ToUint8Array(encoded);
    if (!bytes || bytes.length === 0) {
      logWarn("decodeChunkBytes: Failed to decode base64 or empty bytes");
      return [];
    }

    const firstNonWhitespace = this.findFirstNonWhitespaceByte(bytes);
    if (firstNonWhitespace === 0x7b || firstNonWhitespace === 0x5b) {
      const direct = this.decodeUtf8(bytes);
      return this.splitJsonLines(direct);
    }

    const eventMessages = this.decodeEventStreamMessages(bytes);
    if (eventMessages.length > 0) {
      return eventMessages;
    }

    logWarn("decodeChunkBytes: EventStream decoding failed, falling back to plain UTF-8");
    const fallback = this.decodeUtf8(bytes);
    return this.splitJsonLines(fallback);
  }

  private decodeBase64ToUint8Array(encoded: string): Uint8Array | null {
    try {
      if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(encoded, "base64"));
      }

      if (typeof atob === "function") {
        const binary = atob(encoded);
        const output = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          output[i] = binary.charCodeAt(i);
        }
        return output;
      }

      return null;
    } catch {
      return null;
    }
  }

  private findFirstNonWhitespaceByte(bytes: Uint8Array): number | null {
    for (let i = 0; i < bytes.length; i += 1) {
      const value = bytes[i];
      if (value === undefined) {
        continue;
      }
      if (!this.isWhitespaceByte(value)) {
        return value;
      }
    }
    return null;
  }

  private isWhitespaceByte(value: number): boolean {
    return value === 0x09 || value === 0x0a || value === 0x0d || value === 0x20;
  }

  private decodeUtf8(bytes: Uint8Array): string {
    if (bytes.length === 0) {
      return "";
    }

    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder().decode(bytes);
    }

    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("utf-8");
    }

    return "";
  }

  private splitJsonLines(value: string): string[] {
    if (!value) {
      return [];
    }

    return value
      .split("\n")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  /**
   * Parse AWS EventStream messages from a byte buffer.
   * Returns parsed message payloads and any remaining incomplete bytes.
   */
  private parseEventStreamBuffer(bytes: Uint8Array): {
    messages: string[];
    remainingBytes: Uint8Array;
  } {
    const messages: string[] = [];
    if (bytes.length < 12) {
      return { messages, remainingBytes: bytes };
    }

    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let offset = 0;
    while (offset + 12 <= bytes.length) {
      const totalLength = dataView.getUint32(offset, false);
      const headersLength = dataView.getUint32(offset + 4, false);

      // Check if we have the complete message
      if (offset + totalLength > bytes.length) {
        // Incomplete message, return what we have so far
        break;
      }

      if (totalLength <= 0 || headersLength < 0 || headersLength + 12 > totalLength) {
        logWarn(
          `parseEventStreamBuffer: Invalid message structure at offset ${offset}: totalLength=${totalLength}, headersLength=${headersLength}`
        );
        break;
      }

      const payloadStart = offset + 12 + headersLength;
      const payloadEnd = offset + totalLength - 4;

      if (payloadStart > payloadEnd || payloadEnd > bytes.length) {
        logWarn(`parseEventStreamBuffer: Invalid payload bounds at offset ${offset}`);
        break;
      }

      if (payloadStart < bytes.length) {
        const payloadSlice = bytes.subarray(payloadStart, payloadEnd);
        const decoded = this.decodeUtf8(payloadSlice).trim();
        if (decoded.length > 0) {
          messages.push(decoded);
        }
      }

      offset += totalLength;
      if (totalLength === 0) {
        break;
      }
    }

    // Return remaining bytes that couldn't form a complete message
    const remainingBytes = offset < bytes.length ? bytes.subarray(offset) : new Uint8Array(0);
    return { messages, remainingBytes };
  }

  private decodeEventStreamMessages(bytes: Uint8Array): string[] {
    const { messages } = this.parseEventStreamBuffer(bytes);
    return messages;
  }

  private buildChunkMetadata(innerEvent: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      provider: "amazon-bedrock",
    };

    if (typeof innerEvent?.type === "string") {
      metadata.event_type = innerEvent.type;
    }

    if (innerEvent?.index !== undefined) {
      metadata.event_index = innerEvent.index;
    }

    const stopReason = this.extractStopReason(innerEvent);
    if (stopReason) {
      metadata.stop_reason = stopReason;
    }

    const usage = this.extractUsage(innerEvent);
    if (usage) {
      metadata.usage = usage;
    }

    return metadata;
  }

  private extractStreamText(event: any): string | null {
    if (!event || typeof event !== "object") {
      return null;
    }

    const directValues: Array<unknown> = [
      event.text,
      event.outputText,
      event.completion,
      event.resultText,
      event.delta,
    ];

    for (const value of directValues) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    const nestedCandidates: Array<unknown> = [
      event.delta?.text,
      event.delta?.output_text,
      event.delta?.content,
      event.contentBlockDelta?.delta?.text,
      event.contentBlockDelta?.delta?.output_text,
      event.contentBlockDelta?.delta?.content,
      event.content_block_delta?.delta?.text,
      event.content_block_delta?.delta?.output_text,
      event.content_block_delta?.delta?.content,
      event.message?.content,
      event.messageStop?.message?.content,
      event.message_stop?.message?.content,
      event.content,
    ];

    for (const candidate of nestedCandidates) {
      const text = this.extractTextFromCandidate(candidate);
      if (text) {
        return text;
      }
    }

    return null;
  }

  private extractTextFromCandidate(candidate: unknown): string | null {
    if (!candidate) {
      return null;
    }

    if (typeof candidate === "string") {
      return candidate.length > 0 ? candidate : null;
    }

    if (Array.isArray(candidate)) {
      const combined = candidate
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part === "object") {
            if (typeof (part as any).text === "string") {
              return (part as any).text;
            }
            if (typeof (part as any).value === "string") {
              return (part as any).value;
            }
            if (Array.isArray((part as any).content)) {
              return (part as any).content
                .map((sub: any) => (typeof sub?.text === "string" ? sub.text : ""))
                .join("");
            }
          }
          return "";
        })
        .join("");
      return combined.length > 0 ? combined : null;
    }

    if (typeof candidate === "object") {
      const candidateObj = candidate as Record<string, unknown>;
      if (typeof candidateObj.text === "string") {
        return candidateObj.text.length > 0 ? candidateObj.text : null;
      }
      if (candidateObj.text && typeof candidateObj.text === "object") {
        const nestedText = this.extractTextFromCandidate(candidateObj.text);
        if (nestedText) {
          return nestedText;
        }
      }
      if (typeof candidateObj.value === "string") {
        return candidateObj.value.length > 0 ? candidateObj.value : null;
      }
      if (Array.isArray(candidateObj.content)) {
        return this.extractTextFromCandidate(candidateObj.content);
      }
      if (candidateObj.delta) {
        const nestedDelta = this.extractTextFromCandidate(candidateObj.delta);
        if (nestedDelta) {
          return nestedDelta;
        }
      }
      if (candidateObj.message && typeof candidateObj.message === "object") {
        const nestedMessage = this.extractTextFromCandidate(candidateObj.message);
        if (nestedMessage) {
          return nestedMessage;
        }
      }
    }

    return null;
  }

  private extractUsage(event: any): Record<string, unknown> | undefined {
    if (!event || typeof event !== "object") {
      return undefined;
    }

    if (event.usage && typeof event.usage === "object") {
      return event.usage as Record<string, unknown>;
    }

    if (event.metrics && typeof event.metrics === "object") {
      return event.metrics as Record<string, unknown>;
    }

    // Bedrock-specific invocation metrics
    if (
      event["amazon-bedrock-invocationMetrics"] &&
      typeof event["amazon-bedrock-invocationMetrics"] === "object"
    ) {
      return event["amazon-bedrock-invocationMetrics"] as Record<string, unknown>;
    }

    if (event.messageStop && typeof event.messageStop === "object") {
      return this.extractUsage(event.messageStop);
    }

    if (event.message_stop && typeof event.message_stop === "object") {
      return this.extractUsage(event.message_stop);
    }

    return undefined;
  }

  private extractStopReason(event: any): string | undefined {
    if (!event || typeof event !== "object") {
      return undefined;
    }

    const stopReason =
      event.stop_reason ||
      event.stopReason ||
      event.completionReason ||
      event.completion_reason ||
      event.reason ||
      event.messageStop?.stopReason ||
      event.message_stop?.stop_reason ||
      (event.type === "message_stop" ? event.reason : undefined);

    return typeof stopReason === "string" ? stopReason : undefined;
  }

  private buildTerminalMetadataChunk(
    stopReason?: string,
    usage?: Record<string, unknown>
  ): ChatGenerationChunk {
    const usageMetadata = usage ? this.normaliseUsageMetadata(usage) : undefined;
    const responseMetadata: Record<string, unknown> = {
      provider: "amazon-bedrock",
    };

    if (stopReason) {
      responseMetadata.stop_reason = stopReason;
    }

    if (usage) {
      responseMetadata.usage = usage;
    }

    const messageChunk = new AIMessageChunk({
      content: "",
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
    });

    return new ChatGenerationChunk({
      message: messageChunk,
      text: "",
      generationInfo: responseMetadata,
    });
  }

  private normaliseUsageMetadata(usage: Record<string, unknown>): UsageMetadata {
    const inputTokens =
      this.coerceNumber(usage.inputTokens) ??
      this.coerceNumber(usage.input_tokens) ??
      this.coerceNumber(usage.inputTokenCount) ?? // Bedrock-specific
      this.coerceNumber(usage.promptTokens) ??
      this.coerceNumber(usage.prompt_tokens) ??
      0;

    const outputTokens =
      this.coerceNumber(usage.outputTokens) ??
      this.coerceNumber(usage.output_tokens) ??
      this.coerceNumber(usage.outputTokenCount) ?? // Bedrock-specific
      this.coerceNumber(usage.completionTokens) ??
      this.coerceNumber(usage.completion_tokens) ??
      0;

    const totalTokens =
      this.coerceNumber(usage.totalTokens) ??
      this.coerceNumber(usage.total_tokens) ??
      inputTokens + outputTokens;

    const metadata: UsageMetadata = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    };

    return metadata;
  }

  private coerceNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private buildRequestBody(
    messages: BaseMessage[],
    options?: BedrockChatModelCallOptions
  ): Record<string, unknown> {
    const conversation: Array<{
      role: "assistant" | "user";
      content: Array<{ type: "text"; text: string }>;
    }> = [];
    const systemPrompts: string[] = [];

    messages.forEach((message) => {
      const content = this.normaliseMessageContent(message);
      if (!content) {
        return;
      }

      const messageType = message._getType();
      if (messageType === "system") {
        systemPrompts.push(content);
        return;
      }

      conversation.push({
        role: messageType === "ai" ? "assistant" : "user",
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      });
    });

    const resolvedMaxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const resolvedTemperature = options?.temperature ?? this.defaultTemperature;
    const resolvedTopP = options?.topP ?? this.defaultTopP;

    const payload: Record<string, unknown> = {
      messages: conversation,
    };

    if (systemPrompts.length > 0) {
      payload.system = systemPrompts.join("\n\n");
    }
    if (resolvedMaxTokens !== undefined) {
      payload.max_tokens = resolvedMaxTokens;
    }
    if (resolvedTemperature !== undefined) {
      payload.temperature = resolvedTemperature;
    }
    if (resolvedTopP !== undefined) {
      payload.top_p = resolvedTopP;
    }
    if (this.anthropicVersion) {
      payload.anthropic_version = this.anthropicVersion;
    }

    return payload;
  }

  private normaliseMessageContent(message: BaseMessage): string {
    const { content } = message;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part === "object" && part !== null) {
            if ("text" in part && typeof part.text === "string") {
              return part.text;
            }
            if ("content" in part && typeof part.content === "string") {
              return part.content;
            }
          }
          return "";
        })
        .join("");
    }

    if (typeof content === "object" && content !== null && "text" in content) {
      const textContent = (content as { text?: string }).text;
      return textContent ?? "";
    }

    return "";
  }

  private extractText(data: any): string {
    if (typeof data?.outputText === "string") {
      return data.outputText;
    }

    if (Array.isArray(data?.content)) {
      return data.content
        .map((item: any) => {
          if (!item) return "";
          if (typeof item === "string") return item;
          if (typeof item === "object") {
            if (typeof item.text === "string") return item.text;
            if (item.text && typeof item.text === "object" && "text" in item.text) {
              return item.text.text ?? "";
            }
          }
          return "";
        })
        .join("");
    }

    if (typeof data?.completion === "string") {
      return data.completion;
    }

    if (typeof data?.resultText === "string") {
      return data.resultText;
    }

    return "";
  }
}
