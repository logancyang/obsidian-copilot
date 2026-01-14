/**
 * CodeMirror 6 Extension for Quick Ask feature.
 * Provides StateEffect and ViewPlugin for managing the Quick Ask overlay.
 */

import { StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { QuickAskOverlay } from "@/components/quick-ask/QuickAskOverlay";
import type { QuickAskWidgetPayload } from "@/components/quick-ask/types";

/**
 * StateEffect for showing/hiding the Quick Ask widget.
 * Pass null to close, or a payload to open.
 */
export const quickAskWidgetEffect = StateEffect.define<QuickAskWidgetPayload | null>();

/**
 * ViewPlugin that manages the QuickAskOverlay lifecycle.
 * Responds to StateEffects and updates position on document changes.
 */
export const quickAskOverlayPlugin = ViewPlugin.fromClass(
  class {
    private overlay: QuickAskOverlay | null = null;
    private pos: number | null = null;
    private selectionFrom: number | null = null;
    private selectionTo: number | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      // Handle StateEffects
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(quickAskWidgetEffect)) continue;

          const payload = effect.value;
          if (!payload) {
            // Close the overlay
            this.overlay?.destroy();
            this.overlay = null;
            this.pos = null;
            this.selectionFrom = null;
            this.selectionTo = null;
            continue;
          }

          // Close existing overlay before opening new one
          this.overlay?.destroy();
          this.pos = payload.pos;
          this.selectionFrom = payload.options.selectionFrom;
          this.selectionTo = payload.options.selectionTo;
          this.overlay = new QuickAskOverlay(payload.options);
          this.overlay.mount(payload.pos);
        }
      }

      // Update position and selection range on document changes
      if (this.overlay && update.docChanged) {
        // Update anchor position
        if (this.pos !== null) {
          this.pos = update.changes.mapPos(this.pos);
          this.overlay.updatePosition(this.pos);
        }

        // Update selection range for Replace functionality
        if (this.selectionFrom !== null && this.selectionTo !== null) {
          // Map positions with appropriate assoc to handle insertions at boundaries
          const mappedFrom = update.changes.mapPos(this.selectionFrom, 1);
          const mappedTo = update.changes.mapPos(this.selectionTo, -1);
          this.selectionFrom = Math.min(mappedFrom, mappedTo);
          this.selectionTo = Math.max(mappedFrom, mappedTo);
          this.overlay.updateSelectionRange(this.selectionFrom, this.selectionTo);
        }
      }
    }

    destroy() {
      this.overlay?.destroy();
      this.overlay = null;
      this.pos = null;
      this.selectionFrom = null;
      this.selectionTo = null;
    }
  }
);

/**
 * Creates the Quick Ask CM6 extension array.
 */
export function createQuickAskExtension() {
  return [quickAskOverlayPlugin];
}
