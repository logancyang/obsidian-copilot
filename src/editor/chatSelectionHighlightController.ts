/**
 * ChatSelectionHighlightController
 *
 * Manages persistent selection highlight for the Chat panel.
 * Uses an independent CM6 StateField to avoid conflicts with SelectionHighlight
 * used by QuickAsk and CustomCommandModal.
 */

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";

import type CopilotPlugin from "@/main";
import { CHAT_VIEWTYPE } from "@/constants";
import type { SelectedTextContext } from "@/types/message";
import { logError, logWarn } from "@/logger";

// ============================================================================
// Independent CM6 Highlight Mechanism (does not conflict with SelectionHighlight)
// ============================================================================

/**
 * A highlight range in CM6 document offsets.
 */
interface HighlightRange {
  from: number;
  to: number;
}

/**
 * Normalize and clamp a range to the current document.
 * Returns null when the range is empty or invalid after normalization.
 * @param docLength - The length of the document
 * @param from - The start offset
 * @param to - The end offset
 * @returns Normalized range or null if invalid
 */
function normalizeRange(docLength: number, from: number, to: number): HighlightRange | null {
  const clampedFrom = Math.max(0, Math.min(from, docLength));
  const clampedTo = Math.max(0, Math.min(to, docLength));
  if (clampedFrom === clampedTo) return null;
  return {
    from: Math.min(clampedFrom, clampedTo),
    to: Math.max(clampedFrom, clampedTo),
  };
}

/**
 * Effect used to set or clear the chat selection highlight.
 * - `null` means "hide".
 * - `{from,to}` means "show/update".
 */
const setChatHighlightEffect = StateEffect.define<HighlightRange | null>();

/**
 * Mark decoration used to render the chat selection highlight.
 */
const chatHighlightMark = Decoration.mark({ class: "copilot-chat-selection-highlight" });

/**
 * StateField that stores a single persistent highlight range for Chat.
 * - On doc changes: maps the range using `mapPos` and normalizes.
 * - On effects: updates/clears the range.
 * - Provides decorations via `EditorView.decorations`.
 */
const chatHighlightField = StateField.define<HighlightRange | null>({
  /**
   * Initializes with no highlight.
   */
  create: () => null,

  /**
   * Updates highlight state:
   * - Maps existing range through document changes
   * - Applies set/clear effects
   */
  update(value, tr) {
    let next = value;

    // Map existing range through document changes
    if (next && !tr.changes.empty) {
      const mappedFrom = tr.changes.mapPos(next.from, 1);
      const mappedTo = tr.changes.mapPos(next.to, -1);
      next = normalizeRange(tr.state.doc.length, mappedFrom, mappedTo);
    }

    // Apply effects
    for (const effect of tr.effects) {
      if (effect.is(setChatHighlightEffect)) {
        if (!effect.value) {
          next = null;
        } else {
          next = normalizeRange(tr.state.doc.length, effect.value.from, effect.value.to);
        }
      }
    }

    return next;
  },

  /**
   * Exposes mark decorations derived from the current range.
   */
  provide: (field) =>
    EditorView.decorations.from(field, (range) =>
      range
        ? Decoration.set([chatHighlightMark.range(range.from, range.to)])
        : Decoration.none
    ),
});

/**
 * Minimal default theme for the chat selection highlight.
 */
const chatHighlightTheme = EditorView.baseTheme({
  ".copilot-chat-selection-highlight": {
    backgroundColor: "var(--text-selection)",
    borderRadius: "2px",
  },
});

/**
 * Extension that enables chat selection highlight support.
 */
const chatHighlightExtension = [chatHighlightField, chatHighlightTheme];

/**
 * Hide chat selection highlight on a specific EditorView.
 * Used for global cleanup during plugin unload.
 * @param view - The EditorView to clear highlight from
 */
export function hideChatSelectionHighlight(view: EditorView): void {
  try {
    if (view.state.field(chatHighlightField, false) === undefined) return;
    view.dispatch({ effects: [setChatHighlightEffect.of(null)] });
  } catch {
    // Ignore errors during cleanup
  }
}

// ============================================================================
// Controller
// ============================================================================

/**
 * Snapshot of the current highlight state.
 * Used for idempotency checks and safe cleanup.
 */
interface Snapshot {
  view: EditorView;
  from: number;
  to: number;
}

/**
 * Options for ChatSelectionHighlightController.
 */
export interface ChatSelectionHighlightControllerOptions {
  /** Close QuickAsk when entering Chat. Default: false */
  closeQuickAskOnChatFocus?: boolean;
}

/**
 * Controller that manages Chat-owned persistent selection highlight lifecycle.
 *
 * This controller uses an independent CM6 StateField to avoid conflicts with
 * SelectionHighlight used by QuickAsk and CustomCommandModal.
 *
 * Key features:
 * - Persists editor selection when focus moves to Chat panel
 * - Automatically clears highlight when leaving Chat
 * - Supports both mouse click and keyboard navigation to Chat
 * - Idempotent: avoids redundant dispatches
 */
export class ChatSelectionHighlightController {
  private readonly plugin: CopilotPlugin;
  private readonly closeQuickAskOnChatFocus: boolean;

  /** Last active Markdown leaf, used for fallback when active view is already Chat */
  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  /** Whether the last active leaf was a MarkdownView */
  private lastActiveLeafWasMarkdown = false;
  /** Snapshot of current highlight for idempotency and cleanup */
  private snapshot: Snapshot | null = null;

  /**
   * Creates a new ChatSelectionHighlightController.
   * @param plugin - The CopilotPlugin instance
   * @param options - Optional configuration
   */
  constructor(plugin: CopilotPlugin, options?: ChatSelectionHighlightControllerOptions) {
    this.plugin = plugin;
    this.closeQuickAskOnChatFocus = options?.closeQuickAskOnChatFocus ?? false;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initializes the controller state from the current active leaf.
   * Call once during plugin onload.
   */
  initialize(): void {
    const leaf = this.plugin.app.workspace.activeLeaf ?? null;
    this.lastActiveLeafWasMarkdown = !!(leaf?.view instanceof MarkdownView);
    if (this.lastActiveLeafWasMarkdown && leaf) {
      this.lastActiveMarkdownLeaf = leaf;
    }
  }

  /**
   * Cleans up the controller state.
   * Call during plugin onunload.
   */
  cleanup(): void {
    this.clear();
    this.lastActiveMarkdownLeaf = null;
    this.lastActiveLeafWasMarkdown = false;
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Handles active-leaf-change event.
   * Manages highlight lifecycle based on leaf transitions:
   * - Entering Chat from Markdown: persists selection highlight
   * - Leaving Chat: clears highlight
   * @param leaf - The newly active leaf, or null
   */
  handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const prevWasMarkdown = this.lastActiveLeafWasMarkdown;
    const nextType = leaf?.getViewState().type ?? null;
    const nextIsMarkdown = !!(leaf?.view instanceof MarkdownView);

    // Update tracking
    this.lastActiveLeafWasMarkdown = nextIsMarkdown;
    if (nextIsMarkdown && leaf) {
      this.lastActiveMarkdownLeaf = leaf;
    }

    // Leaving Chat: clear highlight
    if (this.snapshot && nextType !== CHAT_VIEWTYPE) {
      this.clear();
    }

    // Entering Chat from Markdown: persist with fallback allowed
    if (nextType === CHAT_VIEWTYPE && prevWasMarkdown) {
      if (this.closeQuickAskOnChatFocus) {
        this.plugin.quickAskController?.close(false);
      }

      // Use fallback because active leaf is already Chat at this point
      this.persist({ useFallback: true });
    }
  }

  /**
   * Persists highlight when user clicks into Chat panel.
   * Uses capture phase to run before focus changes.
   * Does not use fallback - only works if MarkdownView is currently active.
   */
  persistFromPointerDown(): void {
    // Early exit if already in Chat - no MarkdownView will be active
    const activeLeafType = this.plugin.app.workspace.activeLeaf?.getViewState().type;
    if (activeLeafType === CHAT_VIEWTYPE) {
      return;
    }

    this.persist({ useFallback: false });
  }

  /**
   * Clears highlight if no note contexts remain after removal.
   * @param nextContexts - The remaining contexts after removal
   */
  clearIfNoNoteContexts(nextContexts: ReadonlyArray<SelectedTextContext>): void {
    if (!nextContexts.some((ctx) => ctx.sourceType === "note")) {
      this.clear();
    }
  }

  /**
   * Clears highlight when starting a new chat session.
   */
  clearForNewChat(): void {
    this.clear();
  }

  // --------------------------------------------------------------------------
  // Internal: CM6 Operations
  // --------------------------------------------------------------------------

  /**
   * Persists the current editor selection as a CM6 decoration highlight.
   * @param options - Configuration for this persist operation
   * @param options.useFallback - Whether to use lastActiveMarkdownLeaf if active view is not Markdown
   */
  private persist(options: { useFallback: boolean }): void {
    const cm = this.getEditorView(options.useFallback);
    if (!cm) return;

    const sel = cm.state.selection.main;
    if (sel.from === sel.to) return;

    const from = sel.from;
    const to = sel.to;

    // Idempotency: skip if same highlight already exists
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

    // Clear previous highlight on different view
    if (this.snapshot && this.snapshot.view !== cm) {
      this.hideHighlight(this.snapshot.view);
    }

    this.showHighlight(cm, from, to);
    this.snapshot = { view: cm, from, to };
  }

  /**
   * Clears the current highlight unconditionally.
   * Always clears to avoid "stuck" highlights when document changes
   * cause mapPos to shift the range.
   */
  private clear(): void {
    if (!this.snapshot) return;

    this.hideHighlight(this.snapshot.view);
    this.snapshot = null;
  }

  /**
   * Gets the EditorView to use for highlight operations.
   * @param allowFallback - Whether to fall back to lastActiveMarkdownLeaf
   * @returns The EditorView, or null if not available
   */
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

  // --------------------------------------------------------------------------
  // Internal: CM6 Highlight Primitives
  // --------------------------------------------------------------------------

  /**
   * Shows a highlight on the given EditorView.
   * Automatically installs the extension if not already present.
   * @param view - The EditorView to highlight
   * @param from - Start offset
   * @param to - End offset
   */
  private showHighlight(view: EditorView, from: number, to: number): void {
    try {
      const effects: StateEffect<unknown>[] = [];

      // Install extension if needed
      if (view.state.field(chatHighlightField, false) === undefined) {
        effects.push(StateEffect.appendConfig.of(chatHighlightExtension));
      }

      effects.push(setChatHighlightEffect.of({ from, to }));
      view.dispatch({ effects });
    } catch (error) {
      logError("ChatSelectionHighlight show failed:", error);
    }
  }

  /**
   * Hides the highlight on the given EditorView.
   * Uses logWarn instead of logError since failures during cleanup
   * are often due to view being destroyed (normal race condition).
   * @param view - The EditorView to clear highlight from
   */
  private hideHighlight(view: EditorView): void {
    try {
      if (view.state.field(chatHighlightField, false) === undefined) return;
      view.dispatch({ effects: [setChatHighlightEffect.of(null)] });
    } catch (error) {
      // Use warn instead of error - failures here are often due to
      // view being destroyed, which is a normal race condition
      logWarn("ChatSelectionHighlight hide failed (view may be destroyed):", error);
    }
  }

  /**
   * Gets the current highlight range from the EditorView.
   * @param view - The EditorView to query
   * @returns The current highlight range, or null if none
   */
  private getHighlightRange(view: EditorView): HighlightRange | null {
    return view.state.field(chatHighlightField, false) ?? null;
  }
}
