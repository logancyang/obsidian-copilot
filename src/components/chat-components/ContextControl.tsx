import { App } from "obsidian";
import React from "react";

import { useChainType } from "@/aiParams";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { SelectedTextContext } from "@/types/message";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";
import { NoteReference } from "@/types/note";
import { getNoteReferenceKey } from "@/utils/noteUtils";

interface ChatControlsProps {
  app: App;
  excludeNotePaths: string[];
  contextNotes: NoteReference[];
  setContextNotes: React.Dispatch<React.SetStateAction<NoteReference[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  activeNote: TFile | null;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;
  showProgressCard: () => void;
}

export const ContextControl: React.FC<ChatControlsProps> = ({
  app,
  excludeNotePaths,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  activeNote,
  contextUrls,
  onRemoveUrl,
  selectedTextContexts,
  onRemoveSelectedText,
  showProgressCard,
}) => {
  const [selectedChain] = useChainType();

  const handleAddContext = () => {
    new AddContextNoteModal({
      app,
      onNoteSelect: (note: TFile) => {
        if (activeNote && note.path === activeNote.path) {
          setIncludeActiveNote(true);
          // Remove the note from contextNotes if it exists there
          setContextNotes((prev) => prev.filter((n) => n.file.path !== note.path));
        } else {
          // Add wasAddedManually flag to distinguish from reference-added notes
          const noteReference = {
            file: note,
            addedVia: "user-action",
          } as NoteReference;
          setContextNotes((prev) => [...prev, noteReference]);
        }
      },
      excludeNotePaths,
      chainType: selectedChain,
    }).open();
  };

  const handleRemoveContext = (noteReference: NoteReference) => {
    // First check if this note was added manually
    const noteToRemove = contextNotes.find(
      (note) => getNoteReferenceKey(note) === getNoteReferenceKey(noteReference)
    );
    const wasAddedManually = noteToRemove?.addedVia === "user-action";

    if (wasAddedManually) {
      // If it was added manually, just remove it from contextNotes
      setContextNotes((prev) =>
        prev.filter((note) => getNoteReferenceKey(note) !== getNoteReferenceKey(noteReference))
      );
    } else {
      // If it wasn't added manually, it could be either:
      // 1. The active note (controlled by includeActiveNote)
      // 2. A note added via [[reference]]
      // In either case, we should:
      setIncludeActiveNote(false); // Turn off includeActiveNote if this was the active note
      setContextNotes((prev) =>
        prev.filter((note) => getNoteReferenceKey(note) !== getNoteReferenceKey(noteReference))
      ); // Remove from contextNotes if it was there
    }
  };

  // Context menu is now available for all chain types

  return (
    <ChatContextMenu
      activeNote={includeActiveNote ? activeNote : null}
      contextNotes={contextNotes}
      onAddContext={handleAddContext}
      onRemoveContext={handleRemoveContext}
      contextUrls={contextUrls}
      onRemoveUrl={onRemoveUrl}
      selectedTextContexts={selectedTextContexts}
      onRemoveSelectedText={onRemoveSelectedText}
      showProgressCard={showProgressCard}
    />
  );
};
