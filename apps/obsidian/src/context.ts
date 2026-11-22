import { EVENT_NAMES } from "@/constants";
import { App } from "obsidian";
import * as React from "react";

export const AppContext = React.createContext<App | undefined>(undefined);

export class ChatViewEventTarget extends EventTarget {
  private pendingInsertText: string | null = null;
  private visiblePending = false;

  queueInsertText(text: string): void {
    this.pendingInsertText = text;
    this.dispatchEvent(new CustomEvent(EVENT_NAMES.INSERT_TEXT_TO_CHAT, { detail: { text } }));
  }

  consumePendingInsertText(): string | null {
    const text = this.pendingInsertText;
    this.pendingInsertText = null;
    return text;
  }

  queueVisible(): void {
    this.visiblePending = true;
    this.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
  }

  consumePendingVisible(): boolean {
    const pending = this.visiblePending;
    this.visiblePending = false;
    return pending;
  }
}

export const EventTargetContext = React.createContext<EventTarget | undefined>(undefined);

export function useApp(): App {
  const app = React.useContext(AppContext);
  if (!app) {
    throw new Error("useApp() called outside of an <AppContext.Provider>");
  }
  return app;
}
