import { Plus } from "lucide-react";
import { TFile } from "obsidian";
import React from "react";
import { TooltipActionButton } from "./TooltipActionButton";

interface ChatContextMenuProps {
  activeNote: TFile | null;
  contextNotes: TFile[];
  contextUrls: string[];
  onAddContext: () => void;
  onRemoveContext: (path: string) => void;
  onRemoveUrl: (url: string) => void;
}

export const ChatContextMenu: React.FC<ChatContextMenuProps> = ({
  activeNote,
  contextNotes,
  contextUrls,
  onAddContext,
  onRemoveContext,
  onRemoveUrl,
}) => {
  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.path, note]));

    return Array.from(notesMap.values()).filter(
      (note) => !(activeNote && note.path === activeNote.path)
    );
  }, [contextNotes, activeNote]);

  const uniqueUrls = React.useMemo(() => Array.from(new Set(contextUrls)), [contextUrls]);

  const renderNote = (note: TFile, isActive = false) => (
    <div key={note.path} className={`context-note ${isActive ? "active" : "with-hover"}`}>
      <span className="note-name">{note.basename}</span>
      {isActive && <span className="note-badge">current</span>}
      {note.extension === "pdf" && <span className="note-badge pdf">pdf</span>}
      <button
        className="remove-note"
        onClick={() => onRemoveContext(note.path)}
        aria-label="Remove from context"
      >
        ×
      </button>
    </div>
  );

  return (
    <div className="chat-context-menu">
      <TooltipActionButton onClick={onAddContext} Icon={<Plus className="icon-scaler" />}>
        Add Note to Context
      </TooltipActionButton>
      <div className="context-notes">
        {activeNote && renderNote(activeNote, true)}
        {uniqueNotes.map((note) => renderNote(note))}
        {uniqueUrls.map((url) => (
          <div key={url} className="context-note url">
            <span className="note-name" title={url}>
              {new URL(url).hostname}
            </span>
            <span className="note-badge">url</span>
            <button
              className="remove-note"
              onClick={() => onRemoveUrl(url)}
              aria-label="Remove URL from context"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
