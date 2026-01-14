/**
 * Controller for the Quick Ask feature.
 * Manages the lifecycle of Quick Ask panels and integrates with CM6.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import { quickAskWidgetEffect, quickAskOverlayPlugin } from "./quickAskExtension";
import { QuickAskOverlay } from "@/components/quick-ask/QuickAskOverlay";
import type CopilotPlugin from "@/main";

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
      state.view.dispatch({ effects: quickAskWidgetEffect.of(null) });
      return;
    }

    // Clear state to prevent duplicate close
    this.quickAskWidgetState = null;

    // Try to trigger close animation
    const hasAnimation = QuickAskOverlay.closeCurrentWithAnimation();

    if (!hasAnimation) {
      // If no animation instance, dispatch close effect directly
      state.view.dispatch({ effects: quickAskWidgetEffect.of(null) });
      state.view.focus();
    }
  }

  /**
   * Shows the Quick Ask panel for the given editor.
   * @param editor - The Obsidian editor instance
   * @param view - The CodeMirror EditorView
   */
  show(editor: Editor, view: EditorView): void {
    const selection = view.state.selection.main;
    const selectedText = editor.getSelection();
    const selectionFrom = selection.from;
    const selectionTo = selection.to;

    // Close any existing Quick Ask panel
    this.close(false);

    const close = (restoreFocus = true) => {
      const isCurrentView = !this.quickAskWidgetState || this.quickAskWidgetState.view === view;

      if (isCurrentView) {
        this.quickAskWidgetState = null;
      }
      view.dispatch({ effects: quickAskWidgetEffect.of(null) });

      if (isCurrentView && restoreFocus) {
        view.focus();
      }
    };

    view.dispatch({
      effects: [
        // First clear any existing widget
        quickAskWidgetEffect.of(null),
        // Then create the new widget
        quickAskWidgetEffect.of({
          pos: selection.head,
          options: {
            plugin: this.plugin,
            editor,
            view,
            selectedText,
            selectionFrom,
            selectionTo,
            onClose: () => close(true),
          },
        }),
      ],
    });

    this.quickAskWidgetState = { view, pos: selection.head, close };
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
