import { Plus, X } from "lucide-react";
import { TFile } from "obsidian";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectedTextContext } from "@/sharedState";

interface ChatContextMenuProps {
  activeNote: TFile | null;
  contextNotes: TFile[];
  contextUrls: string[];
  selectedTextContexts?: SelectedTextContext[];
  onAddContext: () => void;
  onRemoveContext: (path: string) => void;
  onRemoveUrl: (url: string) => void;
  onRemoveSelectedText?: (id: string) => void;
}

function ContextNote({
  note,
  isActive = false,
  onRemoveContext,
}: {
  note: TFile;
  isActive: boolean;
  onRemoveContext: (path: string) => void;
}) {
  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">{note.basename}</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
        {note.extension === "pdf" && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext(note.path)}
        aria-label="Remove from context"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

function ContextUrl({ url, onRemoveUrl }: { url: string; onRemoveUrl: (url: string) => void }) {
  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">{url}</span>
        <span className="tw-text-xs tw-text-faint">Link</span>
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveUrl(url)}
        aria-label="Remove from context"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

function ContextSelection({
  selectedText,
  onRemoveSelectedText,
}: {
  selectedText: SelectedTextContext;
  onRemoveSelectedText: (id: string) => void;
}) {
  const lineRange =
    selectedText.startLine === selectedText.endLine
      ? `L${selectedText.startLine}`
      : `L${selectedText.startLine}-${selectedText.endLine}`;

  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">{selectedText.noteTitle}</span>
        <span className="tw-text-xs tw-text-faint">{lineRange}</span>
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveSelectedText(selectedText.id)}
        aria-label="Remove from context"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

export const ChatContextMenu: React.FC<ChatContextMenuProps> = ({
  activeNote,
  contextNotes,
  contextUrls,
  selectedTextContexts = [],
  onAddContext,
  onRemoveContext,
  onRemoveUrl,
  onRemoveSelectedText,
}) => {
  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.path, note]));

    return Array.from(notesMap.values()).filter((note) => {
      // If the note was added manually, always show it in the list
      if ((note as any).wasAddedManually) {
        return true;
      }

      // For non-manually added notes, show them if they're not the active note
      return !(activeNote && note.path === activeNote.path);
    });
  }, [contextNotes, activeNote]);

  const uniqueUrls = React.useMemo(() => Array.from(new Set(contextUrls)), [contextUrls]);

  const hasContext =
    uniqueNotes.length > 0 ||
    uniqueUrls.length > 0 ||
    selectedTextContexts.length > 0 ||
    !!activeNote;

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-gap-1">
      <div className="tw-flex tw-h-full tw-items-start">
        <Button
          onClick={onAddContext}
          variant="ghost2"
          size="fit"
          className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border"
        >
          <Plus className="tw-size-4" />
          {!hasContext && <span className="tw-pr-1 tw-text-xs tw-leading-4">Add context</span>}
        </Button>
      </div>
      <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">
        {activeNote && (
          <ContextNote
            key={activeNote.path}
            note={activeNote}
            isActive={true}
            onRemoveContext={onRemoveContext}
          />
        )}
        {uniqueNotes.map((note) => (
          <ContextNote
            key={note.path}
            note={note}
            isActive={false}
            onRemoveContext={onRemoveContext}
          />
        ))}
        {uniqueUrls.map((url) => (
          <ContextUrl key={url} url={url} onRemoveUrl={onRemoveUrl} />
        ))}
        {selectedTextContexts.map((selectedText) => (
          <ContextSelection
            key={selectedText.id}
            selectedText={selectedText}
            onRemoveSelectedText={onRemoveSelectedText || (() => {})}
          />
        ))}
      </div>
    </div>
  );
};
