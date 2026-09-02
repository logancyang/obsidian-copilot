import { EVENT_NAMES } from "@/constants";
import { App } from "obsidian";
import * as React from "react";

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

/**
 * Per-chat-view event bus. Beyond plain pub/sub it latches requests so a
 * consumer that subscribes while the view is still mounting receives them.
 * This removes any dependence on a freshly-opened view's mount timing.
 */
export class ChatViewEventTarget extends EventTarget {
  private pendingInsertText: string | null = null;
  // A command-launched Agent Chat request must survive a newly revealed view's
  // mount without being copied into or replacing its composer draft.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
  private pendingSubmitPrompts: string[] = [];
  private visiblePending = false;

  /** Queue text for the chat input and notify any already-attached listener. */
  queueInsertText(text: string): void {
    this.pendingInsertText = text;
    this.dispatchEvent(new CustomEvent(EVENT_NAMES.INSERT_TEXT_TO_CHAT, { detail: { text } }));
  }

  /** Take and clear the latched text; returns null once it has been consumed. */
  consumePendingInsertText(): string | null {
    const text = this.pendingInsertText;
    this.pendingInsertText = null;
    return text;
  }

  /**
   * Queue a prompt for Agent Chat's normal send lifecycle.
   * @param prompt - The complete user prompt to submit.
   */
  queueSubmitPrompt(prompt: string): void {
    // Command requests can arrive back-to-back before Agent Chat finishes
    // mounting; keep every request in arrival order instead of replacing one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
    this.pendingSubmitPrompts.push(prompt);
    this.dispatchEvent(new CustomEvent(EVENT_NAMES.SUBMIT_AGENT_PROMPT));
  }

  /** Take the oldest latched Agent Chat prompt. */
  consumePendingSubmitPrompt(): string | null {
    return this.pendingSubmitPrompts.shift() ?? null;
  }

  /**
   * Queue a "view became visible" focus request and notify any already-attached
   * listener. Latches like {@link queueInsertText} so a view opened while still
   * mounting drains it on attach — no dependence on mount timing.
   */
  queueVisible(): void {
    this.visiblePending = true;
    this.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
  }

  /** Take and clear the latched visibility; returns false once consumed. */
  consumePendingVisible(): boolean {
    const pending = this.visiblePending;
    this.visiblePending = false;
    return pending;
  }
}

// Event target context
export const EventTargetContext = React.createContext<EventTarget | undefined>(undefined);

/**
 * Returns the Obsidian {@link App} provided by the nearest {@link AppContext}.
 *
 * Use this inside React components and hooks instead of touching the global
 * `app` object. Throws if no provider is in scope so callers fail loud rather
 * than silently picking up the wrong window's app in popouts.
 */
export function useApp(): App {
  const app = React.useContext(AppContext);
  if (!app) {
    throw new Error("useApp() called outside of an <AppContext.Provider>");
  }
  return app;
}
