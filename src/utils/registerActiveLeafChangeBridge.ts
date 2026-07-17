import { EVENT_NAMES } from "@/constants";
import { MarkdownView, type ItemView } from "obsidian";

/**
 * Bridge Obsidian's workspace `active-leaf-change` onto a view-local
 * `eventTarget` so React consumers (via `useActiveFile`) re-read the active
 * file when the user switches notes.
 *
 * Each chat-ish view self-owns this bridge rather than relying on a single
 * plugin-level dispatch: `useActiveFile` listens on the view's own
 * `eventTarget`, so a view that never feeds its target stays frozen at its
 * mount seed. Registering through the view's `registerEvent` ties the listener
 * to the view lifecycle (auto-unregistered on close).
 */
export function registerActiveLeafChangeBridge(view: ItemView, eventTarget: EventTarget): void {
  view.registerEvent(
    view.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) {
        eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE));
      }
    })
  );
}
