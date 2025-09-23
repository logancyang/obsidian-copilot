import React from "react";
import { $isNotePillNode } from "../pills/NotePillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

/**
 * Props for the NotePillSyncPlugin component
 */
interface NotePillSyncPluginProps {
  /** Callback triggered when the list of note pills changes */
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  /** Callback triggered when note pills are removed from the editor */
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
}

/**
 * Note data structure extracted from note pill nodes
 */
type NoteData = { path: string; basename: string };

/**
 * Configuration for note pill synchronization
 */
const notePillConfig: PillSyncConfig<NoteData> = {
  isPillNode: $isNotePillNode,
  extractData: (node: any) => ({
    path: node.getNotePath(),
    basename: node.getNoteTitle(),
  }),
  getKey: (note: NoteData) => note.path, // Use path as unique key
};

/**
 * Lexical plugin that monitors note pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to note pills to keep external state in sync with editor content.
 */
export function NotePillSyncPlugin({ onNotesChange, onNotesRemoved }: NotePillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={notePillConfig}
      onChange={onNotesChange}
      onRemoved={onNotesRemoved}
    />
  );
}
