/**
 * CommentAgentSession - per-comment streaming chat session.
 *
 * Lives outside the React tree so the agent can keep running when the
 * comment popover closes. Owns the memory, chain, abort controller, and
 * streaming text for one comment. Subscribers (the panel UI) pull state
 * via `subscribe()` and do not control the lifecycle.
 */
import type { RunnableSequence } from "@langchain/core/runnables";
import type { BaseChatMemory } from "@langchain/classic/memory";
import { Notice, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import type { CustomModel } from "@/aiParams";
import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";
import { commentStore } from "@/comments/CommentStore";
import { COMMENT_THREAD_SYSTEM_PROMPT } from "@/comments/commentSystemPrompt";
import { parseSuggestEditReply } from "@/comments/suggestEditParser";
import type { Comment, CommentMessage } from "@/comments/types";
import { ABORT_REASON } from "@/constants";
import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { logError, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { findCustomModel } from "@/utils";

export interface CommentAgentSessionState {
  isStreaming: boolean;
  streamingText: string;
}

export interface CommentAgentSessionParams {
  plugin: CopilotPlugin;
  notePath: string;
  commentId: string;
}

type Listener = (state: CommentAgentSessionState) => void;

function getModelKey(model: CustomModel): string {
  return `${model.name}|${model.provider}`;
}

/** Mirrors the model selection used by the original comment thread hook. */
function resolveModel(): CustomModel | null {
  const settings = getSettings();
  const preferredKey = settings.quickCommandModelKey ?? settings.defaultModelKey;
  try {
    const model = findCustomModel(preferredKey, settings.activeModels);
    if (!model.enabled) {
      return settings.activeModels.find((m) => m.enabled) ?? null;
    }
    return model;
  } catch {
    return settings.activeModels.find((m) => m.enabled) ?? null;
  }
}

/**
 * Only the first turn embeds the full <selected_text> + <active_note> blocks;
 * subsequent turns rely on chain memory to keep context cheap.
 */
async function buildTurnPrompt(
  plugin: CopilotPlugin,
  notePath: string,
  exactText: string,
  userInput: string,
  isFirstTurn: boolean
): Promise<string> {
  if (!isFirstTurn) return userInput;

  const file = plugin.app.vault.getAbstractFileByPath(notePath);
  let noteContent = "";
  if (file instanceof TFile) {
    try {
      noteContent = await plugin.app.vault.cachedRead(file);
    } catch (error) {
      logWarn("CommentAgentSession: failed to read active note", error);
    }
  }

  const parts: string[] = [];
  parts.push(`<selected_text>\n${exactText}\n</selected_text>`);
  if (noteContent) {
    parts.push(`<active_note>\n${noteContent}\n</active_note>`);
  }
  parts.push(userInput);
  return parts.join("\n\n");
}

function shouldSkipPersistOnAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const reason = signal.reason;
  if (typeof reason !== "string") return true;
  // UNMOUNT is used when the session is disposed (comment deleted / plugin unload).
  return reason === ABORT_REASON.UNMOUNT || reason === ABORT_REASON.NEW_CHAT;
}

export class CommentAgentSession {
  private listeners = new Set<Listener>();
  private isStreaming = false;
  private streamingText = "";

  private memory: BaseChatMemory | null = null;
  private chain: RunnableSequence | null = null;
  private chainModelKey: string | null = null;
  private hasSavedContextOnce = false;

  private abortController: AbortController | null = null;
  private turnId = 0;
  private disposed = false;

  constructor(private readonly params: CommentAgentSessionParams) {}

  getState(): CommentAgentSessionState {
    return { isStreaming: this.isStreaming, streamingText: this.streamingText };
  }

  /** Subscribe to state changes. Immediately fires with current state. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  async sendMessage(input: string): Promise<void> {
    if (this.disposed) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (this.isStreaming) return;

    const { notePath, commentId, plugin } = this.params;
    const comment: Comment | null = commentStore.getComment(notePath, commentId);
    if (!comment) return;

    const model = resolveModel();
    if (!model) {
      new Notice("No active model configured. Please configure a model in Copilot settings.");
      return;
    }

    const userMsg: CommentMessage = {
      id: uuidv4(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    commentStore.appendMessage(notePath, commentId, userMsg);

    const currentTurnId = ++this.turnId;
    const abortController = new AbortController();
    this.abortController = abortController;

    this.streamingText = "";
    this.isStreaming = true;
    this.emit();

    const handleDelta = (text: string): void => {
      if (this.turnId !== currentTurnId) return;
      this.streamingText = text;
      this.emit();
    };
    const thinkStreamer = new ThinkBlockStreamer(handleDelta, true);

    let didNonAbortError = false;
    let memory: BaseChatMemory | null = null;
    let prompt = "";

    try {
      const isFirstTurn = !this.hasSavedContextOnce;
      prompt = await buildTurnPrompt(
        plugin,
        notePath,
        comment.anchor.exactText,
        trimmed,
        isFirstTurn
      );
      if (abortController.signal.aborted) return;
      if (!prompt.trim()) return;

      const chainAndMemory = await this.getOrCreateChain(model, abortController.signal);
      if (!chainAndMemory) return;
      memory = chainAndMemory.memory;

      const chainWithSignal = chainAndMemory.chain.withConfig({
        signal: abortController.signal,
      });
      const stream = await chainWithSignal.stream({ input: prompt });
      for await (const chunk of stream) {
        thinkStreamer.processChunk(chunk);
        if (abortController.signal.aborted) break;
      }
    } catch (error) {
      const isAbort =
        (error instanceof Error && error.name === "AbortError") || abortController.signal.aborted;
      if (!isAbort) {
        didNonAbortError = true;
        logError("CommentAgentSession streaming error:", error);
        new Notice("Error generating reply. Please try again.");
      }
    } finally {
      const result = thinkStreamer.close().content.trim();
      const isStale = this.turnId !== currentTurnId;
      const skipPersist = shouldSkipPersistOnAbort(abortController.signal);

      if (!didNonAbortError && result && !skipPersist && !isStale && !this.disposed) {
        if (memory) {
          try {
            const compacted = compactAssistantOutput(result);
            await memory.saveContext(
              { input: prompt },
              { output: typeof compacted === "string" ? compacted : result }
            );
            this.hasSavedContextOnce = true;
          } catch (error) {
            logError("CommentAgentSession: saveContext failed", error);
          }
        }

        const parsed = parseSuggestEditReply(result);
        const assistantMsg: CommentMessage = {
          id: uuidv4(),
          role: "assistant",
          content:
            parsed.conversationalText || (parsed.proposedEdit ? "Here is a suggested edit:" : ""),
          timestamp: Date.now(),
          ...(parsed.proposedEdit
            ? {
                suggestedEdit: {
                  proposedText: parsed.proposedEdit,
                  status: "pending" as const,
                },
              }
            : {}),
        };
        commentStore.appendMessage(notePath, commentId, assistantMsg);
      }

      if (this.abortController === abortController) {
        this.abortController = null;
      }
      if (!isStale) {
        this.streamingText = "";
        this.isStreaming = false;
        this.emit();
      }
    }
  }

  /** User-initiated stop. Partial output is still persisted. */
  stop(): void {
    this.abortController?.abort(ABORT_REASON.USER_STOPPED);
  }

  /** Abort and tear down. Any in-flight turn will skip persistence. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController?.abort(ABORT_REASON.UNMOUNT);
    this.abortController = null;
    this.listeners.clear();
    this.chain = null;
    this.memory = null;
  }

  private async getOrCreateChain(
    model: CustomModel,
    signal: AbortSignal
  ): Promise<{ chain: RunnableSequence; memory: BaseChatMemory } | null> {
    const modelKey = getModelKey(model);
    const needsRecreate = !this.chain || this.chainModelKey !== modelKey;

    if (needsRecreate) {
      if (!this.memory) {
        this.memory = createChatMemory();
      }
      const nextChain = await createChatChain(model, COMMENT_THREAD_SYSTEM_PROMPT, this.memory);
      if (signal.aborted) return null;
      this.chain = nextChain;
      this.chainModelKey = modelKey;
    }

    if (!this.chain || !this.memory) return null;
    return { chain: this.chain, memory: this.memory };
  }
}
