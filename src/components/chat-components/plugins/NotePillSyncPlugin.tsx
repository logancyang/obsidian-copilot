import React from "react";
import { $isNotePillNode } from "@/components/chat-components/pills/NotePillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

interface NotePillSyncPluginProps {
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
}

type NoteData = { path: string; basename: string };

const notePillConfig: PillSyncConfig<NoteData> = {
  isPillNode: $isNotePillNode,
  extractData: (node) => {
    const noteNode = node as unknown as { getNotePath: () => string; getNoteTitle: () => string };
    return {
      path: noteNode.getNotePath(),
      basename: noteNode.getNoteTitle(),
    };
  },
  getKey: (note: NoteData) => note.path,
};

export function NotePillSyncPlugin({ onNotesChange, onNotesRemoved }: NotePillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={notePillConfig}
      onChange={onNotesChange}
      onRemoved={onNotesRemoved}
    />
  );
}
