import { EditorView } from "@codemirror/view";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";

import type CopilotPlugin from "@/main";
import { CHAT_VIEWTYPE } from "@/constants";
import type { SelectedTextContext } from "@/types/message";
import { logError, logWarn } from "@/logger";
import {
  createPersistentHighlight,
  type PersistentHighlightRange,
} from "@/editor/persistentHighlight";

const chatHighlight = createPersistentHighlight("copilot-chat-selection-highlight");

export function hideChatSelectionHighlight(view: EditorView): void {
  try {
    const effects = chatHighlight.buildEffects(view, null);
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  } catch {}
}

interface Snapshot {
  view: EditorView;
  from: number;
  to: number;
}

export interface ChatSelectionHighlightControllerOptions {
  closeQuickAskOnChatFocus?: boolean;
}

export class ChatSelectionHighlightController {
  private readonly plugin: CopilotPlugin;
  private readonly closeQuickAskOnChatFocus: boolean;

  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  private lastActiveLeafWasMarkdown = false;
  private snapshot: Snapshot | null = null;

  constructor(plugin: CopilotPlugin, options?: ChatSelectionHighlightControllerOptions) {
    this.plugin = plugin;
    this.closeQuickAskOnChatFocus = options?.closeQuickAskOnChatFocus ?? false;
  }

  initialize(): void {
    const markdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const leaf = markdownView?.leaf ?? null;
    this.lastActiveLeafWasMarkdown = !!markdownView;
    if (this.lastActiveLeafWasMarkdown && leaf) {
      this.lastActiveMarkdownLeaf = leaf;
    }
  }

  cleanup(): void {
    this.clear();
    this.lastActiveMarkdownLeaf = null;
    this.lastActiveLeafWasMarkdown = false;
  }

  handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const prevWasMarkdown = this.lastActiveLeafWasMarkdown;
    const nextType = leaf?.getViewState().type ?? null;
    const nextIsMarkdown = !!(leaf?.view instanceof MarkdownView);

    this.lastActiveLeafWasMarkdown = nextIsMarkdown;
    if (nextIsMarkdown && leaf) {
      this.lastActiveMarkdownLeaf = leaf;
    }

    if (this.snapshot && nextType !== CHAT_VIEWTYPE) {
      this.clear();
    }

    if (nextType === CHAT_VIEWTYPE && prevWasMarkdown) {
      if (this.closeQuickAskOnChatFocus) {
        this.plugin.quickAskController?.close(false);
      }

      this.persist({ useFallback: true });
    }
  }

  persistFromPointerDown(): void {
    if (!this.plugin.app.workspace.getActiveViewOfType(MarkdownView)) {
      return;
    }

    this.persist({ useFallback: false });
  }

  clearIfNoNoteContexts(nextContexts: ReadonlyArray<SelectedTextContext>): void {
    if (!nextContexts.some((ctx) => ctx.sourceType === "note")) {
      this.clear();
    }
  }

  clearForNewChat(): void {
    this.clear();
  }

  private persist(options: { useFallback: boolean }): void {
    const cm = this.getEditorView(options.useFallback);
    if (!cm) return;

    const sel = cm.state.selection.main;
    if (sel.from === sel.to) return;

    const from = sel.from;
    const to = sel.to;

    const current = this.getHighlightRange(cm);
    if (
      this.snapshot?.view === cm &&
      this.snapshot.from === from &&
      this.snapshot.to === to &&
      current?.from === from &&
      current?.to === to
    ) {
      return;
    }

    if (this.snapshot && this.snapshot.view !== cm) {
      this.hideHighlight(this.snapshot.view);
      this.snapshot = null;
    }

    const success = this.showHighlight(cm, from, to);
    if (success) {
      this.snapshot = { view: cm, from, to };
    }
  }

  private clear(): void {
    if (!this.snapshot) return;

    this.hideHighlight(this.snapshot.view);
    this.snapshot = null;
  }

  private getEditorView(allowFallback: boolean): EditorView | null {
    const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.editor?.cm) {
      return active.editor.cm;
    }

    if (allowFallback && this.lastActiveMarkdownLeaf?.view instanceof MarkdownView) {
      return this.lastActiveMarkdownLeaf.view.editor?.cm ?? null;
    }

    return null;
  }

  private showHighlight(view: EditorView, from: number, to: number): boolean {
    try {
      const effects = chatHighlight.buildEffects(view, { from, to });
      if (effects.length === 0) {
        return false;
      }
      view.dispatch({ effects });
      return true;
    } catch (error) {
      logError("ChatSelectionHighlight show failed:", error);
      return false;
    }
  }

  private hideHighlight(view: EditorView): void {
    try {
      const effects = chatHighlight.buildEffects(view, null);
      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    } catch (error) {
      logWarn("ChatSelectionHighlight hide failed (view may be destroyed):", error);
    }
  }

  private getHighlightRange(view: EditorView): PersistentHighlightRange | null {
    return chatHighlight.getRange(view);
  }
}
