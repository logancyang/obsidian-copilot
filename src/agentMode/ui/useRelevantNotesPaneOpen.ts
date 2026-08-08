import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import type { App } from "obsidian";
import { useEffect, useState } from "react";

/** True while a dedicated Relevant Notes pane leaf is open; updates on layout-change. */
export function useRelevantNotesPaneOpen(app: App): boolean {
  const [open, setOpen] = useState(
    () => app.workspace.getLeavesOfType(RELEVANT_NOTES_VIEWTYPE).length > 0
  );
  useEffect(() => {
    // Re-sync on mount in case the workspace changed between the lazy-init read
    // and this effect running (e.g. a layout restored in the same tick).
    const update = () => setOpen(app.workspace.getLeavesOfType(RELEVANT_NOTES_VIEWTYPE).length > 0);
    update();
    const ref = app.workspace.on("layout-change", update);
    return () => app.workspace.offref(ref);
  }, [app]);
  return open;
}
