import { EVENT_NAMES } from "@/constants";
import { EventTargetContext } from "@/context";
import { TFile } from "obsidian";
import { useContext, useEffect, useState } from "react";

export function useActiveFile() {
  const [activeFile, setActiveFile] = useState<TFile | null>(null);
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
  }, [eventTarget]);

  return activeFile;
}
