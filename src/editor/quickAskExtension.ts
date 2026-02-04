/**
 * CodeMirror 6 Extension for Quick Ask feature.
 * Provides StateEffect and ViewPlugin for managing the Quick Ask overlay.
 *
 * NOTE: SelectionHighlight is managed by quickAskController.ts, not here.
 * This avoids "Calls to EditorView.update are not allowed while an update is in progress" errors
 * that occur when dispatching from within ViewPlugin.update().
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
    private fallbackPos: number | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      // Handle StateEffects
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(quickAskWidgetEffect)) continue;

          const payload = effect.value;
          if (!payload) {
            // Close the overlay (highlight is handled by controller)
            this.overlay?.destroy();
            this.overlay = null;
            this.pos = null;
            this.fallbackPos = null;
            continue;
          }

          // Close existing overlay before opening new one
          this.overlay?.destroy();
          this.pos = payload.pos;
          this.fallbackPos = typeof payload.fallbackPos === "number" ? payload.fallbackPos : null;

          // NOTE: SelectionHighlight is now managed by quickAskController.ts
          // to avoid dispatch-during-update errors

          this.overlay = new QuickAskOverlay(payload.options);
          this.overlay.mount(payload.pos, this.fallbackPos);
        }
      }

      // Update position and selection range on document changes
      if (this.overlay && update.docChanged) {
        // Update ReplaceGuard's range mapping (single source of truth for Replace)
        const guard = this.overlay.getReplaceGuard();
        if (guard?.onDocChanged) {
          guard.onDocChanged(update.changes);
        }

        // Update anchor position for panel positioning
        if (this.pos !== null) {
          this.pos = update.changes.mapPos(this.pos);
        }
        if (this.fallbackPos !== null) {
          this.fallbackPos = update.changes.mapPos(this.fallbackPos);
        }
        if (this.pos !== null) {
          this.overlay.updatePosition(this.pos, this.fallbackPos);
        }

        // Trigger panel re-render to update Replace button disabled state
        this.overlay.schedulePanelRerender();
      }
    }

    destroy() {
      // NOTE: SelectionHighlight cleanup is handled by quickAskController.ts
      this.overlay?.destroy();
      this.overlay = null;
      this.pos = null;
      this.fallbackPos = null;
    }
  }
);

/**
 * Creates the Quick Ask CM6 extension array.
 */
export function createQuickAskExtension() {
  return [quickAskOverlayPlugin];
}
