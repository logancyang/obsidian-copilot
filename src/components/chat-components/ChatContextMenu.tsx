import {
  AlertCircle,
  CheckCircle,
  CircleDashed,
  Loader2,
  X,
  FileText,
  Hash,
  Folder,
  ExternalLink,
} from "lucide-react";
import { TFile } from "obsidian";
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectedTextContext } from "@/types/message";
import { ChainType } from "@/chainFactory";
import { Separator } from "@/components/ui/separator";
import { useChainType } from "@/aiParams";
import { useProjectContextStatus } from "@/hooks/useProjectContextStatus";
import { isPlusChain } from "@/utils";
import { AtMentionTypeahead } from "./AtMentionTypeahead";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ChatContextMenuProps {
  activeNote: TFile | null;
  contextNotes: TFile[];
  contextUrls: string[];
  contextTags: string[];
  contextFolders: { name: string; path: string }[];
  selectedTextContexts?: SelectedTextContext[];
  onRemoveContext: (category: string, data: any) => void;
  showProgressCard: () => void;
  onTypeaheadSelect: (category: string, data: any) => void;
  lexicalEditorRef?: React.RefObject<any>;
}

function ContextNote({
  note,
  isActive = false,
  onRemoveContext,
}: {
  note: TFile;
  isActive: boolean;
  onRemoveContext: (category: string, data: any) => void;
}) {
  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
        <span className="tw-max-w-40 tw-truncate">{note.basename}</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
        {note.extension === "pdf" && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext("notes", note.path)}
        aria-label="Remove from context"
        className="tw-text-muted"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

function ContextUrl({
  url,
  onRemoveContext,
}: {
  url: string;
  onRemoveContext: (category: string, data: any) => void;
}) {
  // Extract domain from URL for display
  const getDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <ExternalLink className="tw-size-3" />
        <span className="tw-max-w-40 tw-truncate">{getDomain(url)}</span>
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext("urls", url)}
        aria-label="Remove from context"
        className="tw-text-muted"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

function ContextTag({
  tag,
  onRemoveContext,
}: {
  tag: string;
  onRemoveContext: (category: string, data: any) => void;
}) {
  // Remove # symbol for clean display
  const displayTag = tag.startsWith("#") ? tag.slice(1) : tag;

  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <Hash className="tw-size-3" />
        <span className="tw-max-w-40 tw-truncate">{displayTag}</span>
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext("tags", tag)}
        aria-label="Remove from context"
        className="tw-text-muted"
      >
        <X className="tw-size-4" />
      </Button>
    </Badge>
  );
}

function ContextFolder({
  folder,
  onRemoveContext,
}: {
  folder: { name: string; path: string };
  onRemoveContext: (category: string, data: any) => void;
}) {
  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <Folder className="tw-size-3" />
        <span className="tw-max-w-40 tw-truncate">{folder.path}</span>
      </div>
      <Button
        variant="ghost2"
        size="fit"
        onClick={() => onRemoveContext("folders", folder.path)}
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
  onRemoveContext,
}: {
  selectedText: SelectedTextContext;
  onRemoveContext: (category: string, data: any) => void;
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
        onClick={() => onRemoveContext("selectedText", selectedText.id)}
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
  contextTags,
  contextFolders,
  selectedTextContexts = [],
  onRemoveContext,
  showProgressCard,
  onTypeaheadSelect,
  lexicalEditorRef,
}) => {
  const [currentChain] = useChainType();
  const contextStatus = useProjectContextStatus();
  const [showTypeahead, setShowTypeahead] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isCopilotPlus = isPlusChain(currentChain);

  const handleTypeaheadClose = () => {
    setShowTypeahead(false);
  };

  // Simple wrapper that adds focus management to the ContextControl handler
  const handleTypeaheadSelect = (category: string, data: any) => {
    // Delegate to ContextControl handler
    onTypeaheadSelect(category, data);

    // Return focus to the editor after selection
    setTimeout(() => {
      if (lexicalEditorRef?.current) {
        lexicalEditorRef.current.focus();
      }
    }, 100);
  };

  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.path, note]));

    return Array.from(notesMap.values()).filter((note) => {
      // Show all notes except the active note (when it's already displayed separately)
      return !(activeNote && note.path === activeNote.path);
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
        <Popover open={showTypeahead} onOpenChange={setShowTypeahead}>
          <PopoverTrigger asChild>
            <Button
              ref={buttonRef}
              variant="ghost2"
              size="fit"
              className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted"
            >
              <span className="tw-text-base tw-font-medium tw-leading-none">@</span>
              {!hasContext && <span className="tw-pr-1 tw-text-sm tw-leading-4">Add context</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="tw-w-80 tw-p-0" align="start" side="top" sideOffset={4}>
            <AtMentionTypeahead
              isOpen={showTypeahead}
              onClose={handleTypeaheadClose}
              onSelect={handleTypeaheadSelect}
              isCopilotPlus={isCopilotPlus}
            />
          </PopoverContent>
        </Popover>
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
          <ContextUrl key={url} url={url} onRemoveContext={onRemoveContext} />
        ))}
        {contextTags.map((tag) => (
          <ContextTag key={tag} tag={tag} onRemoveContext={onRemoveContext} />
        ))}
        {contextFolders.map((folder) => (
          <ContextFolder key={folder.path} folder={folder} onRemoveContext={onRemoveContext} />
        ))}
        {selectedTextContexts.map((selectedText) => (
          <ContextSelection
            key={selectedText.id}
            selectedText={selectedText}
            onRemoveContext={onRemoveContext}
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
