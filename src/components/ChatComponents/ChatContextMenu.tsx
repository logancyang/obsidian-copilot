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
  const uniqueUrls = Array.from(new Set(contextUrls));
  const uniqueNotes = Array.from(
    new Set(contextNotes.filter((note) => note.path !== activeNote?.path).map((note) => note.path))
  )
    .map((path) => contextNotes.find((note) => note.path === path))
    .filter((note): note is TFile => note !== undefined);

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
        {uniqueNotes.map((note) => (
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
