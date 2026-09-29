import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView } from "obsidian";
import { quickAskWidgetEffect, quickAskOverlayPlugin } from "./quickAskExtension";
import { QuickAskOverlay } from "@/components/quick-ask/QuickAskOverlay";
import { createMapPosReplaceGuard } from "./replaceGuard";
import { SelectionHighlight } from "./selectionHighlight";
import type CopilotPlugin from "@/main";
import { logWarn } from "@/logger";
import { computeSelectionAnchors } from "@/utils/selectionAnchors";

interface QuickAskWidgetState {
  view: EditorView;
  close: (restoreFocus?: boolean) => void;
}

export class QuickAskController {
  private plugin: CopilotPlugin;
  private quickAskWidgetState: QuickAskWidgetState | null = null;

  constructor(plugin: CopilotPlugin) {
    this.plugin = plugin;
  }

  close(restoreFocus = true): void {
    const state = this.quickAskWidgetState;
    if (!state) {
      return;
    }

    if (!restoreFocus) {
      this.quickAskWidgetState = null;
      try {
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(state.view, null),
        ];
        state.view.dispatch({ effects });
      } catch (error) {
        logWarn("Failed to dispatch close effect:", error);
      }
      return;
    }

    this.quickAskWidgetState = null;

    const hasAnimation = QuickAskOverlay.closeCurrentWithAnimation();

    if (!hasAnimation) {
      try {
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(state.view, null),
        ];
        state.view.dispatch({ effects });
        state.view.focus();
      } catch (error) {
        logWarn("Failed to dispatch close effect or focus:", error);
      }
    }
  }

  show(markdownView: MarkdownView, view: EditorView): void {
    const selection = view.state.selection.main;
    const editor = markdownView.editor;
    const leaf = markdownView.leaf;
    const filePath = markdownView.file?.path ?? null;

    const selectedTextSnapshot = view.state.doc.sliceString(selection.from, selection.to);
    const selectionFrom = selection.from;
    const selectionTo = selection.to;

    this.close(false);

    const replaceGuard = createMapPosReplaceGuard({
      editorView: view,
      leafSnapshot: leaf,
      filePathSnapshot: filePath,
      selectedTextSnapshot,
      initialRange: { from: selectionFrom, to: selectionTo },
      getLeafState: () => {
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
        const effects = [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(view, null),
        ];
        view.dispatch({ effects });

        if (isCurrentView && restoreFocus) {
          view.focus();
        }
      } catch (error) {
        logWarn("Failed to dispatch close effect or focus:", error);
      }
    };

    try {
      const anchors = computeSelectionAnchors(selection, view.state.doc);

      view.dispatch({
        effects: [
          quickAskWidgetEffect.of(null),
          ...SelectionHighlight.buildEffects(view, null),
          quickAskWidgetEffect.of({
            bottomAnchorPos: anchors.bottomPos,
            topAnchorPos: anchors.topPos,
            focusAnchorPos: anchors.focusPos,
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

      this.quickAskWidgetState = { view, close };
    } catch (error) {
      logWarn("Failed to show Quick Ask panel:", error);
      this.quickAskWidgetState = null;
    }
  }

  isOpen(): boolean {
    return this.quickAskWidgetState !== null;
  }

  createExtension(): Extension {
    return [quickAskOverlayPlugin];
  }
}
