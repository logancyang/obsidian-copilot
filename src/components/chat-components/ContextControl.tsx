import { App, TFile } from "obsidian";
import React, { useState } from "react";
import { useChainType } from "@/aiParams";
import { AddContextModal } from "@/components/AddContextModal";
import { SelectedTextContext } from "@/types/message";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  app: App;
  excludeNotePaths: string[];
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  contextFolders: string[];
  setContextFolders: React.Dispatch<React.SetStateAction<string[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  activeNote: TFile | null;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;
  showProgressCard: () => void;
}

const ContextControl: React.FC<ChatControlsProps> = ({
  app,
  excludeNotePaths,
  contextNotes,
  setContextNotes,
  contextFolders,
  setContextFolders,
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
  const [isAddContextModalOpen, setIsAddContextModalOpen] = useState(false);
  const handleAddContext = () => {
    setIsAddContextModalOpen(true);
  };

  // Callback for handling file/folder selection
  const handleNoteSelect = (noteOrPath: TFile | string) => {
    if (typeof noteOrPath === "string") {
      // Handle special removal commands from AddContextModal
      if (noteOrPath.startsWith("REMOVE_FOLDER:")) {
        const folderPath = noteOrPath.replace("REMOVE_FOLDER:", "");
        handleRemoveFolder(folderPath);
        return;
      } else if (noteOrPath.startsWith("REMOVE_FILE:")) {
        const filePath = noteOrPath.replace("REMOVE_FILE:", "");
        handleRemoveContext(filePath);
        return;
      }

      // Processing folder paths
      const folderPath = noteOrPath;
      if (!contextFolders.includes(folderPath)) {
        setContextFolders((prev) => [...prev, folderPath]);
      }
    } else {
      // Processing file
      const note = noteOrPath;
      if (activeNote && note.path === activeNote.path) {
        setIncludeActiveNote(true);
        // Remove the note from contextNotes if it exists there
        setContextNotes((prev) => prev.filter((n) => n.path !== note.path));
      } else {
        // Add wasAddedManually flag to distinguish from reference-added notes
        setContextNotes((prev) => [...prev, Object.assign(note, { wasAddedManually: true })]);
      }
    }
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

  const handleRemoveFolder = (folderPath: string) => {
    setContextFolders((prev) => prev.filter((path) => path !== folderPath));
  };

  // Context menu is now available for all chain types

  return (
    <>
      <ChatContextMenu
        activeNote={includeActiveNote ? activeNote : null}
        contextNotes={contextNotes}
        contextFolders={contextFolders}
        onAddContext={handleAddContext}
        onRemoveContext={handleRemoveContext}
        onRemoveFolder={handleRemoveFolder}
        contextUrls={contextUrls}
        onRemoveUrl={onRemoveUrl}
        selectedTextContexts={selectedTextContexts}
        onRemoveSelectedText={onRemoveSelectedText}
        showProgressCard={showProgressCard}
      />
      <AddContextModal
        app={app}
        chainType={selectedChain}
        excludeNotePaths={excludeNotePaths}
        activeNote={activeNote}
        contextNotes={contextNotes}
        contextFolders={contextFolders}
        onNoteSelect={handleNoteSelect}
        isOpen={isAddContextModalOpen}
        onClose={() => setIsAddContextModalOpen(false)}
      >
        <div />
      </AddContextModal>
    </>
  );
};

export default ContextControl;
