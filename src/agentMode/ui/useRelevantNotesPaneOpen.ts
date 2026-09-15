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

/**
 * True while a dedicated Relevant Notes pane is visible, even without focus.
 * @param app - The workspace whose dedicated panes share the chat shelf.
 */
export function useRelevantNotesPaneOpen(app: App): boolean {
  const [open, setOpen] = useState(() => hasVisiblePane(app));
  useEffect(() => {
    // Re-sync on mount in case the workspace changed between the lazy-init read
    // and this effect running (e.g. a layout restored in the same tick).
    const update = () => setOpen(hasVisiblePane(app));
    update();
    const refs = [
      app.workspace.on("layout-change", update),
      app.workspace.on("active-leaf-change", update),
      // Sidebar collapse can finish hiding its contents after the focus event.
      app.workspace.on("resize", update),
    ];
    return () => refs.forEach((ref) => app.workspace.offref(ref));
  }, [app]);
  return open;
}
