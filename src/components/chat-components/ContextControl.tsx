import { App } from "obsidian";
import React from "react";

import { useChainType } from "@/aiParams";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { SelectedTextContext } from "@/types/message";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  app: App;
  excludeNotePaths: string[];
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  activeNote: TFile | null;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  contextTags: string[];
  onRemoveTag: (tagName: string) => void;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;
  showProgressCard: () => void;
  onContextNoteRemoved?: (notePath: string) => void;
}

const ContextControl: React.FC<ChatControlsProps> = ({
  app,
  excludeNotePaths,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  activeNote,
  contextUrls,
  onRemoveUrl,
  contextTags,
  onRemoveTag,
  selectedTextContexts,
  onRemoveSelectedText,
  showProgressCard,
  onContextNoteRemoved,
}) => {
  const [selectedChain] = useChainType();
  const handleAddContext = () => {
    new AddContextNoteModal({
      app,
      onNoteSelect: (note) => {
        if (activeNote && note.path === activeNote.path) {
          setIncludeActiveNote(true);
          // Remove the note from contextNotes if it exists there
          setContextNotes((prev) => prev.filter((n) => n.path !== note.path));
        } else {
          // Check if this note already exists (added via token)
          setContextNotes((prev) => {
            const existingNote = prev.find((n) => n.path === note.path);
            if (existingNote) {
              // Note already exists via token, mark it as also manually added
              return prev.map((n) =>
                n.path === note.path ? Object.assign(n, { wasAddedManually: true }) : n
              );
            } else {
              // New note, add with manual flag
              return [...prev, Object.assign(note, { wasAddedManually: true })];
            }
          });
        }
      },
      excludeNotePaths,
      chainType: selectedChain,
    }).open();
  };

  const handleRemoveContext = (path: string) => {
    // When removing from context menu, ALWAYS remove from contextNotes
    // This will trigger the pill sync to remove all corresponding tokens

    // Handle active note case
    if (activeNote && path === activeNote.path) {
      setIncludeActiveNote(false);
    }

    // Always remove from contextNotes - this triggers pill removal
    setContextNotes((prev) => prev.filter((note) => note.path !== path));

    // Call the callback to remove pills from the editor
    if (onContextNoteRemoved) {
      onContextNoteRemoved(path);
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
      contextTags={contextTags}
      onRemoveTag={onRemoveTag}
      selectedTextContexts={selectedTextContexts}
      onRemoveSelectedText={onRemoveSelectedText}
      showProgressCard={showProgressCard}
    />
  );
};

export default ContextControl;
