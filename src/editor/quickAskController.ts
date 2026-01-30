/**
 * Controller for the Quick Ask feature.
 * Manages the lifecycle of Quick Ask panels and integrates with CM6.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView } from "obsidian";
import { quickAskWidgetEffect, quickAskOverlayPlugin } from "./quickAskExtension";
import { QuickAskOverlay } from "@/components/quick-ask/QuickAskOverlay";
import { createMapPosReplaceGuard } from "./replaceGuard";
import { SelectionHighlight } from "./selectionHighlight";
import type CopilotPlugin from "@/main";
import { logWarn } from "@/logger";

interface QuickAskWidgetState {
  view: EditorView;
  pos: number;
  close: (restoreFocus?: boolean) => void;
}

/**
 * Controller that manages Quick Ask panel instances.
 */
export class QuickAskController {
  private plugin: CopilotPlugin;
  private quickAskWidgetState: QuickAskWidgetState | null = null;

  constructor(plugin: CopilotPlugin) {
    this.plugin = plugin;
  }

  /**
   * Closes the current Quick Ask panel.
   * @param restoreFocus - Whether to restore focus to the editor
   */
  close(restoreFocus = true): void {
    const state = this.quickAskWidgetState;
    if (!state) {
      return;
    }

    if (!restoreFocus) {
      this.quickAskWidgetState = null;
      try {
        // Combine widget close and highlight hide in one dispatch
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(state.view, null),
        ];
        state.view.dispatch({ effects });
      } catch (error) {
        // View may have been destroyed - clear state and continue
        logWarn("Failed to dispatch close effect:", error);
      }
      return;
    }

    // Clear state to prevent duplicate close
    this.quickAskWidgetState = null;

    // Try to trigger close animation
    const hasAnimation = QuickAskOverlay.closeCurrentWithAnimation();

    if (!hasAnimation) {
      // If no animation instance, dispatch close effect directly
      try {
        // Combine widget close and highlight hide in one dispatch
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(state.view, null),
        ];
        state.view.dispatch({ effects });
        state.view.focus();
      } catch (error) {
        // View may have been destroyed - already cleared state above
        logWarn("Failed to dispatch close effect or focus:", error);
      }
    }
  }

  /**
   * Shows the Quick Ask panel for the given editor.
   * @param markdownView - The MarkdownView instance (for leaf binding)
   * @param view - The CodeMirror EditorView
   */
  show(markdownView: MarkdownView, view: EditorView): void {
    const selection = view.state.selection.main;
    const editor = markdownView.editor;
    const leaf = markdownView.leaf;
    const filePath = markdownView.file?.path ?? null;

    // Get selected text from doc.sliceString (not editor.getSelection() to avoid CRLF issues)
    const selectedTextSnapshot = view.state.doc.sliceString(selection.from, selection.to);
    const selectionFrom = selection.from;
    const selectionTo = selection.to;

    // Close any existing Quick Ask panel
    this.close(false);

    // Create ReplaceGuard
    const replaceGuard = createMapPosReplaceGuard({
      editorView: view,
      leafSnapshot: leaf,
      filePathSnapshot: filePath,
      selectedTextSnapshot,
      initialRange: { from: selectionFrom, to: selectionTo },
      getLeafState: () => {
        // Get current leaf state
        const currentView = leaf.view;
        if (!(currentView instanceof MarkdownView)) {
          return { leaf: null, editorView: null, filePath: null };
        }
        return {
          leaf,
          editorView: currentView.editor?.cm ?? null,
          filePath: currentView.file?.path ?? null,
        };
      },
    });

    const close = (restoreFocus = true) => {
      const isCurrentView = !this.quickAskWidgetState || this.quickAskWidgetState.view === view;

      if (isCurrentView) {
        this.quickAskWidgetState = null;
      }
      try {
        // Combine widget close and highlight hide in one dispatch
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(view, null),
        ];
        view.dispatch({ effects });

        if (isCurrentView && restoreFocus) {
          view.focus();
        }
      } catch (error) {
        // View may have been destroyed
        logWarn("Failed to dispatch close effect or focus:", error);
      }
    };

    try {
      view.dispatch({
        effects: [
          // First clear any existing widget and highlight
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(view, null),
          // Then create the new widget with highlight
          quickAskWidgetEffect.of({
            pos: selection.head,
            fallbackPos: selection.anchor,
            options: {
              plugin: this.plugin,
              editor,
              view,
              selectedText: selectedTextSnapshot,
              selectionFrom,
              selectionTo,
              replaceGuard,
              onClose: () => close(true),
            },
          }),
          ...SelectionHighlight.buildEffects(view, { from: selectionFrom, to: selectionTo }),
        ],
      });

      this.quickAskWidgetState = { view, pos: selection.head, close };
    } catch (error) {
      // View may have been destroyed
      logWarn("Failed to show Quick Ask panel:", error);
      this.quickAskWidgetState = null;
    }
  }

  /**
   * Checks if Quick Ask is currently open.
   */
  isOpen(): boolean {
    return this.quickAskWidgetState !== null;
  }

  /**
   * Creates the CM6 extension for Quick Ask.
   * This should be registered with the editor.
   */
  createExtension(): Extension {
    return [quickAskOverlayPlugin];
  }
}
