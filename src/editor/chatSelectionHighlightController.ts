import { EditorView } from "@codemirror/view";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";

import type CopilotPlugin from "@/main";
import { CHAT_AGENT_VIEWTYPE, CHAT_VIEWTYPE } from "@/constants";
import type { SelectedTextContext } from "@/types/message";
import { logError, logWarn } from "@/logger";
import {
  createPersistentHighlight,
  type PersistentHighlightRange,
} from "@/editor/persistentHighlight";
import { activeReadingSelection } from "@/selection/selectionWatcher";

const chatHighlight = createPersistentHighlight("copilot-chat-selection-highlight");
const READING_HIGHLIGHT = "copilot-chat-selection";

export function hideChatSelectionHighlight(view: EditorView): void {
  try {
    const effects = chatHighlight.buildEffects(view, null);
    if (effects.length > 0) {
      view.dispatch({ effects });
    }
  } catch (error) {
    logWarn("Could not hide the chat selection highlight", error);
  }
}

interface Snapshot {
  view: EditorView;
  from: number;
  to: number;
}

interface ReadingSelectionRange {
  view: MarkdownView;
  range: Range;
}

type HighlightWindow = Window & { CSS: typeof CSS; Highlight: typeof Highlight };

export interface ChatSelectionHighlightControllerOptions {
  closeQuickAskOnChatFocus?: boolean;
}

export class ChatSelectionHighlightController {
  private readonly plugin: CopilotPlugin;
  private readonly closeQuickAskOnChatFocus: boolean;

  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  private lastActiveLeafWasMarkdown = false;
  private snapshot: Snapshot | null = null;
  private readingSelection: ReadingSelectionRange | null = null;
  private readingHighlights: HighlightRegistry | null = null;

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

    const watch = (doc: Document) =>
      this.plugin.registerDomEvent(doc, "selectionchange", () =>
        this.rememberReadingSelection(doc)
      );
    watch(activeDocument);
    this.plugin.registerEvent(this.plugin.app.workspace.on("window-open", (win) => watch(win.doc)));
  }

  cleanup(): void {
    this.clear();
    this.lastActiveMarkdownLeaf = null;
    this.lastActiveLeafWasMarkdown = false;
    this.readingSelection = null;
  }

  handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const prevWasMarkdown = this.lastActiveLeafWasMarkdown;
    const nextType = leaf?.getViewState().type ?? null;
    const nextIsChat = nextType === CHAT_VIEWTYPE || nextType === CHAT_AGENT_VIEWTYPE;
    const nextIsMarkdown = !!(leaf?.view instanceof MarkdownView);

    this.lastActiveLeafWasMarkdown = nextIsMarkdown;
    if (nextIsMarkdown && leaf) {
      this.lastActiveMarkdownLeaf = leaf;
    }

    if (!nextIsChat) {
      this.clear();
    }

    if (nextIsChat && prevWasMarkdown) {
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

  private rememberReadingSelection(doc: Document): void {
    const active = activeReadingSelection(this.plugin.app, doc);
    if (!active) return;

    this.readingSelection = active.selection.isCollapsed
      ? null
      : { view: active.view, range: active.selection.getRangeAt(0).cloneRange() };
  }

  private persist(options: { useFallback: boolean }): void {
    const view = this.getMarkdownView(options.useFallback);
    if (view?.getMode() === "preview") {
      this.showReadingHighlight(view);
      return;
    }

    const cm = view?.editor?.cm;
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
    if (this.snapshot) {
      this.hideHighlight(this.snapshot.view);
      this.snapshot = null;
    }

    if (this.readingHighlights) {
      this.readingHighlights.delete(READING_HIGHLIGHT);
      this.readingHighlights = null;
      this.readingSelection = null;
    }
  }

  private getMarkdownView(allowFallback: boolean): MarkdownView | null {
    const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;

    if (allowFallback && this.lastActiveMarkdownLeaf?.view instanceof MarkdownView) {
      return this.lastActiveMarkdownLeaf.view;
    }

    return null;
  }

  private showReadingHighlight(view: MarkdownView): void {
    const remembered = this.readingSelection;
    if (remembered?.view !== view) return;

    const win = view.containerEl.win as HighlightWindow;
    try {
      win.CSS.highlights.set(READING_HIGHLIGHT, new win.Highlight(remembered.range));
      this.readingHighlights = win.CSS.highlights;
    } catch (error) {
      // Obsidian still runs on iOS versions whose WebView has no CSS Custom Highlight API.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/983
      logWarn("Could not highlight the reading view selection", error);
    }
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
