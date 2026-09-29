import { EVENT_NAMES } from "@/constants";
import { MarkdownView, type ItemView } from "obsidian";

export function registerActiveLeafChangeBridge(view: ItemView, eventTarget: EventTarget): void {
  view.registerEvent(
    view.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) {
        eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE));
      }
    })
  );
}
