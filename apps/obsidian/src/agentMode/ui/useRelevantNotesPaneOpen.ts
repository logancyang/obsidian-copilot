import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import type { App } from "obsidian";
import { useEffect, useState } from "react";

function hasVisiblePane(app: App): boolean {
  // Hidden tabs and collapsed sidebars must not suppress the chat shelf.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/468
  return app.workspace
    .getLeavesOfType(RELEVANT_NOTES_VIEWTYPE)
    .some((leaf) => leaf.view.containerEl.isShown());
}

export function useRelevantNotesPaneOpen(app: App): boolean {
  const [open, setOpen] = useState(() => hasVisiblePane(app));
  useEffect(() => {
    const update = () => setOpen(hasVisiblePane(app));
    update();
    const refs = [
      app.workspace.on("layout-change", update),
      app.workspace.on("active-leaf-change", update),
      app.workspace.on("resize", update),
    ];
    return () => refs.forEach((ref) => app.workspace.offref(ref));
  }, [app]);
  return open;
}
