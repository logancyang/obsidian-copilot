import { EVENT_NAMES } from "@/constants";
import { App } from "obsidian";
import * as React from "react";

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

/**
 * Per-chat-view event bus. Beyond plain pub/sub it *latches* a queued
 * "insert text" payload so a consumer that subscribes after the text was
 * queued — e.g. a chat view still mounting when the Relevant Notes pane routes
 * a wikilink to it — still receives it. This removes any dependence on a
 * freshly-opened view's mount timing (previously papered over with a setTimeout).
 */
export class ChatViewEventTarget extends EventTarget {
  private pendingInsertText: string | null = null;

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
