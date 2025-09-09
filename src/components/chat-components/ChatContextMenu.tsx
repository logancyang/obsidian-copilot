import { AlertCircle, CheckCircle, CircleDashed, Loader2, Plus, X } from "lucide-react";
import { TFile } from "obsidian";
import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectedTextContext } from "@/types/message";
import { ChainType } from "@/chainFactory";
import { Separator } from "@/components/ui/separator";
import { useChainType } from "@/aiParams";
import { useProjectContextStatus } from "@/hooks/useProjectContextStatus";
import { NoteReference } from "@/types/note";
import { getNoteReferenceKey } from "@/utils/noteUtils";

interface ChatContextMenuProps {
  activeNote: TFile | null;
  contextNotes: NoteReference[];
  contextUrls: string[];
  selectedTextContexts?: SelectedTextContext[];
  onAddContext: () => void;
  onRemoveContext: (path: string) => void;
  onRemoveUrl: (url: string) => void;
  onRemoveSelectedText?: (id: string) => void;
  showProgressCard: () => void;
}

function ContextNote({
  note,
  isActive = false,
  onRemoveContext,
}: {
  note: NoteReference;
  isActive: boolean;
  onRemoveContext: (path: string) => void;
}) {
  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">{note.file.name}</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
        {note.file.extension === "pdf" && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext(note.file.path)}
        aria-label="Remove from context"
        className="tw-text-muted"
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
        className="tw-text-muted"
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
        className="tw-text-muted"
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
  showProgressCard,
}) => {
  const activeNoteReference = useMemo(() => {
    return {
      file: activeNote,
    } as NoteReference;
  }, [activeNote]);

  const [currentChain] = useChainType();
  const contextStatus = useProjectContextStatus();

  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.file.path, note]));

    return Array.from(notesMap.values()).filter((note) => {
      // If the note was added manually, always show it in the list
      if (note.addedVia === "user-action") {
        return true;
      }

      // For non-manually added notes, show them if they're not the active note
      return !(activeNote && note.file.path === activeNote.path);
    });
  }, [contextNotes, activeNote]);

  const uniqueUrls = React.useMemo(() => Array.from(new Set(contextUrls)), [contextUrls]);

  const hasContext =
    uniqueNotes.length > 0 ||
    uniqueUrls.length > 0 ||
    selectedTextContexts.length > 0 ||
    !!activeNote;

  // Get contextStatus from the shared hook
  const getContextStatusIcon = () => {
    switch (contextStatus) {
      case "success":
        return <CheckCircle className="tw-size-4 tw-text-success" />;
      case "loading":
        return <Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />;
      case "error":
        return <AlertCircle className="tw-size-4 tw-text-error" />;
      case "initial":
        return <CircleDashed className="tw-size-4 tw-text-faint" />;
    }
  };

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-gap-1">
      <div className="tw-flex tw-h-full tw-items-start">
        <Button
          onClick={onAddContext}
          variant="ghost2"
          size="fit"
          className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted"
        >
          <Plus className="tw-size-4" />
          {!hasContext && <span className="tw-pr-1 tw-text-sm tw-leading-4">Add context</span>}
        </Button>
      </div>
      <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">
        {activeNote && (
          <ContextNote
            key={getNoteReferenceKey(activeNoteReference)}
            note={activeNoteReference}
            isActive={true}
            onRemoveContext={onRemoveContext}
          />
        )}
        {uniqueNotes.map((note) => (
          <ContextNote
            key={getNoteReferenceKey(note)}
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

      {currentChain === ChainType.PROJECT_CHAIN && (
        <>
          <Separator orientation="vertical" />
          <div className="">
            <Button
              variant="ghost2"
              size="fit"
              className="tw-text-muted"
              onClick={() => showProgressCard()}
            >
              {getContextStatusIcon()}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
