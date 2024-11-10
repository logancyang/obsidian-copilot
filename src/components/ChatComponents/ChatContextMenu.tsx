import { Plus } from "lucide-react";
import { TFile } from "obsidian";
import React from "react";
import { TooltipActionButton } from "./TooltipActionButton";

interface ChatContextMenuProps {
  activeNote: TFile | null;
  contextNotes: TFile[];
  onAddContext: () => void;
  onRemoveContext: (path: string) => void;
}

export const ChatContextMenu: React.FC<ChatContextMenuProps> = ({
  activeNote,
  contextNotes,
  onAddContext,
  onRemoveContext,
}) => {
  return (
    <div className="chat-context-menu">
      <TooltipActionButton onClick={onAddContext} Icon={<Plus className="icon-scaler" />}>
        Add Note to Context
      </TooltipActionButton>
      <div className="context-notes">
        {activeNote && (
          <div className="context-note active">
            <span className="note-name">{activeNote.basename}</span>
            <span className="note-badge">current</span>
            <button
              className="remove-note"
              onClick={() => onRemoveContext(activeNote.path)}
              aria-label="Remove from context"
            >
              ×
            </button>
          </div>
        )}
        {contextNotes.map((note) => (
          <div
            key={note.path}
            className={`context-note ${note.path === activeNote?.path ? "active" : "with-hover"}`}
          >
            <span className="note-name">{note.basename}</span>
            {note.path === activeNote?.path && <span className="note-badge">current</span>}
            <button
              className="remove-note"
              onClick={() => onRemoveContext(note.path)}
              aria-label="Remove from context"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
