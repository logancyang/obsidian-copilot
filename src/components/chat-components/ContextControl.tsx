import { useChainType } from "@/aiParams";
import { App } from "obsidian";
import React from "react";

import { ChainType } from "@/chainFactory";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  activeNote: TFile | null;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
}

const ContextControl: React.FC<ChatControlsProps> = ({
  app,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  activeNote,
  contextUrls,
  onRemoveUrl,
}) => {
  const [selectedChain] = useChainType();

  const handleAddContext = () => {
    const excludeNotes = [
      ...contextNotes.map((note) => note.path),
      ...(includeActiveNote && activeNote ? [activeNote.path] : []),
    ].filter(Boolean) as string[];

    new AddContextNoteModal({
      app,
      onNoteSelect: (note) => {
        if (activeNote && note.path === activeNote.path) {
          setIncludeActiveNote(true);
          // Remove the note from contextNotes if it exists there
          setContextNotes((prev) => prev.filter((n) => n.path !== note.path));
        } else {
          // Add wasAddedManually flag to distinguish from reference-added notes
          setContextNotes((prev) => [...prev, Object.assign(note, { wasAddedManually: true })]);
        }
      },
      excludeNotes,
    }).open();
  };

  const handleRemoveContext = (path: string) => {
    // First check if this note was added manually
    const noteToRemove = contextNotes.find((note) => note.path === path);
    const wasAddedManually = noteToRemove && (noteToRemove as any).wasAddedManually;

    if (wasAddedManually) {
      // If it was added manually, just remove it from contextNotes
      setContextNotes((prev) => prev.filter((note) => note.path !== path));
    } else {
      // If it wasn't added manually, it could be either:
      // 1. The active note (controlled by includeActiveNote)
      // 2. A note added via [[reference]]
      // In either case, we should:
      setIncludeActiveNote(false); // Turn off includeActiveNote if this was the active note
      setContextNotes((prev) => prev.filter((note) => note.path !== path)); // Remove from contextNotes if it was there
    }
  };

  if (selectedChain !== ChainType.COPILOT_PLUS_CHAIN) {
    return null;
  }

  return (
    <ChatContextMenu
      activeNote={includeActiveNote ? activeNote : null}
      contextNotes={contextNotes}
      onAddContext={handleAddContext}
      onRemoveContext={handleRemoveContext}
      contextUrls={contextUrls}
      onRemoveUrl={onRemoveUrl}
    />
  );
};

export default ContextControl;
