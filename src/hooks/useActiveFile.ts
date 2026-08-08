import { EVENT_NAMES } from "@/constants";
import { EventTargetContext, useApp } from "@/context";
import { TFile } from "obsidian";
import { useContext, useEffect, useState } from "react";

export function useActiveFile() {
  const app = useApp();
  // Seed from the current active file so a freshly-mounted consumer (e.g. the
  // Relevant Notes pane) renders for the open note immediately, rather than
  // waiting on an ACTIVE_LEAF_CHANGE event that only fires on later switches.
  const [activeFile, setActiveFile] = useState<TFile | null>(() => app.workspace.getActiveFile());
  const eventTarget = useContext(EventTargetContext);

  useEffect(() => {
    const handleActiveLeafChange = () => {
      const activeFile = app.workspace.getActiveFile();
      setActiveFile(activeFile);
    };
    eventTarget?.addEventListener(EVENT_NAMES.ACTIVE_LEAF_CHANGE, handleActiveLeafChange);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ACTIVE_LEAF_CHANGE, handleActiveLeafChange);
    };
  }, [app, eventTarget]);

  return activeFile;
}
