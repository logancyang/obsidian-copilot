import { EVENT_NAMES } from "@/constants";
import { EventTargetContext } from "@/context";
import { TFile } from "obsidian";
import { useContext, useEffect, useState } from "react";

export function useActiveFile() {
  const [activeFile, setActiveFile] = useState<TFile | null>(null);
  const eventTarget = useContext(EventTargetContext);

  useEffect(() => {
    const handleActiveLeafChange = () => {
      const currentFile = app.workspace.getActiveFile();
      setActiveFile(currentFile);
    };

    // Initialize immediately on mount so we have the current active file
    handleActiveLeafChange();

    eventTarget?.addEventListener(EVENT_NAMES.ACTIVE_LEAF_CHANGE, handleActiveLeafChange);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ACTIVE_LEAF_CHANGE, handleActiveLeafChange);
    };
  }, [eventTarget]);

  return activeFile;
}
