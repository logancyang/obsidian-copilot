import { StreamingResult, TokenUsage } from "@/types/message";
import { detectTruncation, extractTokenUsage } from "./finishReasonDetector";
import { formatErrorChunk } from "@/utils/toolResultUtils";
import { NativeToolCall, ToolCallChunk, buildToolCallsFromChunks } from "./nativeToolCalling";
import { logInfo, logWarn } from "@/logger";
import { stripSpecialTokens } from "@/utils/stripSpecialTokens";

export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";
  private errorResponse = "";
  private wasTruncated = false;
  private tokenUsage: TokenUsage | null = null;
  private hasHandledTextLevelThinkTag = false;
  private excludedThinkBlockStart = -1;

  private toolCallChunks: Map<number, ToolCallChunk> = new Map();

  constructor(
    private updateCurrentAiMessage: (message: string) => void,
    private excludeThinking: boolean = false
  ) {
    logInfo(`[ThinkBlockStreamer] Created with excludeThinking=${excludeThinking}`);
  }

  private handleTextLevelThinkTags() {
    if (this.excludeThinking) {
      this.handleExcludedThinkTags();
      return;
    }

    const hasCloseTag = this.fullResponse.includes("</think>");
    const hasOpenTag = this.fullResponse.includes("<think>");

    if (!hasCloseTag) return;

    if (!hasOpenTag && !this.hasHandledTextLevelThinkTag) {
      this.hasHandledTextLevelThinkTag = true;
      logWarn(
        "Detected </think> closing tag without opening <think> tag. " +
          "This may indicate a misconfigured chat template in LM Studio. Adding opening tag."
      );
      this.fullResponse = "<think>" + this.fullResponse;
    }
  }

  private handleExcludedThinkTags() {
    if (this.excludedThinkBlockStart >= 0) {
      const closeIdx = this.fullResponse.indexOf("</think>", this.excludedThinkBlockStart);
      if (closeIdx !== -1) {
        const before = this.fullResponse.substring(0, this.excludedThinkBlockStart);
        const after = this.fullResponse.substring(closeIdx + "</think>".length);
        this.fullResponse = (before + after).trimStart();
        this.excludedThinkBlockStart = -1;
      } else {
        this.fullResponse = this.fullResponse.substring(0, this.excludedThinkBlockStart);
      }
      return;
    }

    const openIdx = this.fullResponse.indexOf("<think>");
    if (openIdx !== -1) {
      this.excludedThinkBlockStart = openIdx;
      const closeIdx = this.fullResponse.indexOf("</think>", openIdx);
      if (closeIdx !== -1) {
        const before = this.fullResponse.substring(0, openIdx);
        const after = this.fullResponse.substring(closeIdx + "</think>".length);
        this.fullResponse = (before + after).trimStart();
        this.excludedThinkBlockStart = -1;
      } else {
        this.fullResponse = this.fullResponse.substring(0, openIdx);
      }
      return;
    }

    const closeIdx = this.fullResponse.indexOf("</think>");
    if (closeIdx !== -1) {
      this.fullResponse = this.fullResponse.substring(closeIdx + "</think>".length).trimStart();
    }
  }

  private handleClaudeChunk(content: Array<{ type?: string; text?: string; thinking?: string }>) {
    let textContent = "";
    let hasThinkingContent = false;
    for (const item of content) {
      switch (item.type) {
        case "text":
          textContent += item.text;
          break;
        case "thinking":
          hasThinkingContent = true;
          if (this.excludeThinking) {
            break;
          }
          if (!this.hasOpenThinkBlock) {
            this.fullResponse += "\n<think>";
            this.hasOpenThinkBlock = true;
          }
          if (item.thinking !== undefined) {
            this.fullResponse += item.thinking;
          }
          this.updateCurrentAiMessage(this.fullResponse);
          break;
      }
    }
    if (textContent && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }
    if (textContent) {
      this.fullResponse += stripSpecialTokens(textContent);
    }
    return hasThinkingContent;
  }

  private handleDeepseekChunk(chunk: {
    content?: string;
    additional_kwargs?: { reasoning_content?: string };
  }) {
    if (typeof chunk.content === "string") {
      this.fullResponse += stripSpecialTokens(chunk.content);
    }

    if (chunk.additional_kwargs?.reasoning_content) {
      if (this.excludeThinking) {
        return true;
      }
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      if (chunk.additional_kwargs.reasoning_content !== undefined) {
        this.fullResponse += chunk.additional_kwargs.reasoning_content;
      }
      return true;
    }
    return false;
  }

  private handleOpenRouterChunk(chunk: {
    content?: string;
    additional_kwargs?: {
      delta?: { reasoning?: string };
      reasoning_details?: unknown[];
    };
  }) {
    if (chunk.additional_kwargs?.delta?.reasoning) {
      if (this.excludeThinking) {
        return true;
      }
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      this.fullResponse += chunk.additional_kwargs.delta.reasoning;
      return true;
    }

    if (typeof chunk.content === "string" && chunk.content && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    if (typeof chunk.content === "string" && chunk.content) {
      this.fullResponse += chunk.content;
    }

    return false;
  }

  private handleToolCallChunks(chunk: {
    tool_call_chunks?: Array<{
      index?: number;
      id?: string;
      name?: string;
      args?: string;
    }>;
  }) {
    const toolCallChunks = chunk.tool_call_chunks;
    if (!toolCallChunks || !Array.isArray(toolCallChunks)) {
      return;
    }

    for (const tc of toolCallChunks) {
      const idx: number = (tc.index as number) ?? 0;
      const existing = this.toolCallChunks.get(idx) || { name: "", args: "" };

      if (tc.id) existing.id = tc.id;
      if (tc.name) existing.name += tc.name;
      if (tc.args) existing.args += tc.args;

      this.toolCallChunks.set(idx, existing);
    }
  }

  processChunk(chunk: {
    response_metadata?: Record<string, unknown>;
    usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    tool_call_chunks?: Array<{ index?: number; id?: string; name?: string; args?: string }>;
    content?: string | Array<{ type?: string; text?: string; thinking?: string }>;
    additional_kwargs?: {
      reasoning_content?: string;
      delta?: { reasoning?: string };
      reasoning_details?: unknown[];
    };
  }) {
    const truncationResult = detectTruncation(chunk);
    if (truncationResult.wasTruncated) {
      this.wasTruncated = true;
    }

    const usage = extractTokenUsage(chunk);
    if (usage) {
      this.tokenUsage = usage;
    }

    this.handleToolCallChunks(chunk);

    const isThinkingChunk =
      Array.isArray(chunk.content) ||
      chunk.additional_kwargs?.delta?.reasoning ||
      (chunk.additional_kwargs?.reasoning_details &&
        Array.isArray(chunk.additional_kwargs.reasoning_details) &&
        chunk.additional_kwargs.reasoning_details.length > 0) ||
      chunk.additional_kwargs?.reasoning_content;

    if (this.hasOpenThinkBlock && !isThinkingChunk) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    if (Array.isArray(chunk.content)) {
      this.handleClaudeChunk(chunk.content);
    } else if (chunk.additional_kwargs?.reasoning_content) {
      this.handleDeepseekChunk(chunk as Parameters<typeof this.handleDeepseekChunk>[0]);
    } else if (isThinkingChunk) {
      this.handleOpenRouterChunk(chunk as Parameters<typeof this.handleOpenRouterChunk>[0]);
    } else {
      this.handleDeepseekChunk(chunk as Parameters<typeof this.handleDeepseekChunk>[0]);
    }

    this.handleTextLevelThinkTags();

    this.updateCurrentAiMessage(this.fullResponse);
  }

  processErrorChunk(errorMessage: string) {
    this.errorResponse = formatErrorChunk(errorMessage);
  }

  getToolCalls(): NativeToolCall[] {
    return buildToolCallsFromChunks(this.toolCallChunks);
  }

  close(): StreamingResult {
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
    }

    this.handleTextLevelThinkTags();

    if (this.errorResponse) {
      this.fullResponse += this.errorResponse;
    }

    this.updateCurrentAiMessage(this.fullResponse);

    return {
      content: this.fullResponse,
      wasTruncated: this.wasTruncated,
      tokenUsage: this.tokenUsage,
    };
  }
}
