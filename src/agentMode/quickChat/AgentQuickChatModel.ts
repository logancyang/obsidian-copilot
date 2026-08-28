import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CustomModel } from "@/aiParams";
import type { AgentSessionManager, SessionEvent } from "@/agentMode";

/** The narrow manager seam needed by the Quick Chat adapter. */
export type QuickChatAgentManager = Pick<AgentSessionManager, "ensureBackendProcess">;

/**
 * Convert LangChain's message history into a text prompt understood by all
 * four Agent backends. The complete history is sent on every Quick Chat call;
 * the Agent process remains the source of truth for account authentication.
 */
export function serializeAgentQuickChatMessages(messages: BaseMessage[]): string {
  return messages
    .map((message) => `[${messageRole(message)}]\n${messageContentToText(message.content)}`)
    .join("\n\n");
}

/**
 * A LangChain-compatible model backed by one of the already-bound Agent
 * processes. It deliberately exposes only text streaming: Quick Chat has no
 * tool schema to pass through, while Agent Mode retains the full tool and
 * permission UI.
 */
export class AgentQuickChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  private readonly manager: QuickChatAgentManager;
  private readonly model: CustomModel;
  private readonly cwd: string;

  constructor(manager: QuickChatAgentManager, model: CustomModel, cwd: string) {
    super({});
    this.manager = manager;
    this.model = model;
    this.cwd = cwd;
  }

  _llmType(): string {
    // LangChain evaluates this during `super()` before subclass fields are
    // initialized, so the stable type intentionally does not inspect `model`.
    return "obsidian-agent";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    let content = "";
    for await (const chunk of this._streamResponseChunks(messages, options, runManager)) {
      content += typeof chunk.text === "string" ? chunk.text : "";
    }
    return {
      generations: [
        {
          text: content,
          message: new AIMessage({ content }),
        },
      ],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const agentType = this.model.agentType;
    if (!agentType) throw new Error("Quick Chat Agent model is missing its agent type.");

    const backend = await this.manager.ensureBackendProcess(agentType);
    const session = await backend.newSession({ cwd: this.cwd });
    const wantedModelId = this.model.name;
    if (session.state.model?.current.baseModelId !== wantedModelId) {
      await backend.setSessionModel({ sessionId: session.sessionId, modelId: wantedModelId });
    }

    const queue = new TextQueue();
    const unregister = backend.registerSessionHandler(session.sessionId, (event) => {
      const text = textFromSessionEvent(event);
      if (text) queue.push(text);
    });

    let cancelled = false;
    const abort = (): void => {
      if (cancelled) return;
      cancelled = true;
      void backend.cancel({ sessionId: session.sessionId });
    };
    const signal = options.signal;
    if (signal?.aborted) {
      abort();
      unregister();
      queue.close();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    let prompt: Promise<{ stopReason: string }>;
    try {
      prompt = backend.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: serializeAgentQuickChatMessages(messages) }],
      });
    } catch (error) {
      unregister();
      signal?.removeEventListener("abort", abort);
      throw error;
    }
    void prompt.then(
      () => queue.close(),
      (error: unknown) => queue.fail(error instanceof Error ? error : new Error(String(error)))
    );

    try {
      for await (const text of queue) {
        yield new ChatGenerationChunk({
          text,
          message: new AIMessageChunk({ content: text }),
        });
      }
      await prompt;
    } finally {
      unregister();
      signal?.removeEventListener("abort", abort);
      if (!cancelled && signal?.aborted) abort();
    }
  }
}

function messageRole(message: BaseMessage): string {
  const type = message.getType();
  switch (type) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "system":
      return "system";
    default:
      return type;
  }
}

function messageContentToText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object") {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string") return text;
        const type = (block as { type?: unknown }).type;
        return typeof type === "string" ? `[${type} content omitted]` : "[content omitted]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function textFromSessionEvent(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  return update.content.type === "text" ? update.content.text : null;
}

class TextQueue implements AsyncIterable<string>, AsyncIterator<string> {
  private values: string[] = [];
  private waiters: Array<{
    resolve: (result: IteratorResult<string>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private error: Error | null = null;

  push(value: string): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveWaiters();
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<string>> {
    if (this.values.length > 0) {
      return Promise.resolve({ value: this.values.shift()!, done: false });
    }
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this;
  }

  private resolveWaiters(): void {
    if (!this.closed || this.values.length > 0) return;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }
}
