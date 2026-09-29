import { StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { QuickAskOverlay } from "@/components/quick-ask/QuickAskOverlay";
import type { QuickAskWidgetPayload } from "@/components/quick-ask/types";
import { mapQuickAskAnchorPositions } from "@/utils/quickAskAnchorMapping";

export const quickAskWidgetEffect = StateEffect.define<QuickAskWidgetPayload | null>();

export const quickAskOverlayPlugin = ViewPlugin.fromClass(
  class {
    private overlay: QuickAskOverlay | null = null;
    private bottomAnchorPos: number | null = null;
    private topAnchorPos: number | null = null;
    private focusAnchorPos: number | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(quickAskWidgetEffect)) continue;

          const payload = effect.value;
          if (!payload) {
            this.overlay?.destroy();
            this.overlay = null;
            this.bottomAnchorPos = null;
            this.topAnchorPos = null;
            this.focusAnchorPos = null;
            continue;
          }

          this.overlay?.destroy();
          this.bottomAnchorPos = payload.bottomAnchorPos;
          this.topAnchorPos =
            typeof payload.topAnchorPos === "number" ? payload.topAnchorPos : null;
          this.focusAnchorPos =
            typeof payload.focusAnchorPos === "number" ? payload.focusAnchorPos : null;

          this.overlay = new QuickAskOverlay(payload.options);
          this.overlay.mount(payload.bottomAnchorPos, this.topAnchorPos, this.focusAnchorPos);
        }
      }

      if (this.overlay && update.docChanged) {
        const guard = this.overlay.getReplaceGuard();
        if (guard?.onDocChanged) {
          guard.onDocChanged(update.changes);
        }

        const mapped = mapQuickAskAnchorPositions(
          {
            bottomAnchorPos: this.bottomAnchorPos,
            topAnchorPos: this.topAnchorPos,
            focusAnchorPos: this.focusAnchorPos,
          },
          update.changes
        );
        this.bottomAnchorPos = mapped.bottomAnchorPos;
        this.topAnchorPos = mapped.topAnchorPos;
        this.focusAnchorPos = mapped.focusAnchorPos;
        if (this.bottomAnchorPos !== null) {
          this.overlay.updatePosition(this.bottomAnchorPos, this.topAnchorPos, this.focusAnchorPos);
        }

        this.overlay.schedulePanelRerender();
      }
    }

    destroy() {
      this.overlay?.destroy();
      this.overlay = null;
      this.bottomAnchorPos = null;
      this.topAnchorPos = null;
      this.focusAnchorPos = null;
    }
  }
);
