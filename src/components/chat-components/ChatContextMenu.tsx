import { AlertCircle, CheckCircle, CircleDashed, FileText, Loader2, X } from "lucide-react";
import { Platform, TFile } from "obsidian";
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextNoteBadge,
  ContextActiveNoteBadge,
  ContextActiveWebTabBadge,
  ContextWebTabBadge,
  ContextUrlBadge,
  ContextFolderBadge,
  FaviconOrGlobe,
} from "@/components/chat-components/ContextBadges";
import { SelectedTextContext, WebTabContext, isWebSelectedTextContext } from "@/types/message";
import { ChainType } from "@/chainFactory";
import { Separator } from "@/components/ui/separator";
import { useChainType } from "@/aiParams";
import { useProjectContextStatus } from "@/hooks/useProjectContextStatus";
import { getDomainFromUrl, isPlusChain, openFileInWorkspace } from "@/utils";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { AtMentionTypeahead } from "./AtMentionTypeahead";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ChatContextMenuProps {
  includeActiveNote: boolean;
  currentActiveFile: TFile | null;
  includeActiveWebTab: boolean;
  activeWebTab: WebTabContext | null;
  contextNotes: TFile[];
  contextUrls: string[];
  contextFolders: string[];
  contextWebTabs: WebTabContext[];
  selectedTextContexts?: SelectedTextContext[];
  onRemoveContext: (category: string, data: any) => void;
  showProgressCard: () => void;
  onTypeaheadSelect: (category: string, data: any) => void;
  lexicalEditorRef?: React.RefObject<any>;
}

function ContextSelection({
  selectedText,
  onRemoveContext,
}: {
  selectedText: SelectedTextContext;
  onRemoveContext: (category: string, data: any) => void;
}) {
  // Handle web selected text
  if (isWebSelectedTextContext(selectedText)) {
    const domain = getDomainFromUrl(selectedText.url);
    return (
      <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
        <div className="tw-flex tw-items-center tw-gap-1">
          <FaviconOrGlobe faviconUrl={selectedText.faviconUrl} />
          <span className="tw-max-w-40 tw-truncate">{selectedText.title || domain}</span>
          <span className="tw-text-xs tw-text-faint">Selection</span>
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

  // Handle note selected text (default)
  const lineRange =
    selectedText.startLine === selectedText.endLine
      ? `L${selectedText.startLine}`
      : `L${selectedText.startLine}-${selectedText.endLine}`;

  return (
    <Badge className="tw-items-center tw-py-0 tw-pl-2 tw-pr-0.5 tw-text-xs">
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
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
  includeActiveNote,
  currentActiveFile,
  includeActiveWebTab,
  activeWebTab,
  contextNotes,
  contextUrls,
  contextFolders,
  contextWebTabs,
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

  /**
   * Handles clicking on a badge to open the file in a new tab (or focus existing tab)
   */
  const handleBadgeClick = (file: TFile) => {
    openFileInWorkspace(file);
  };

  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.path, note]));
    return Array.from(notesMap.values());
  }, [contextNotes]);

  const uniqueUrls = React.useMemo(() => Array.from(new Set(contextUrls)), [contextUrls]);

  // Defensive dedupe for web tabs (by URL) using shared normalization policy
  const uniqueWebTabs = React.useMemo(() => mergeWebTabContexts(contextWebTabs), [contextWebTabs]);

  // Any selection hides both active note and active web tab
  const hasAnySelection = selectedTextContexts.length > 0;

  const activeNoteVisible = includeActiveNote && !hasAnySelection && Boolean(currentActiveFile);
  const activeWebTabVisible =
    includeActiveWebTab && !hasAnySelection && Boolean(activeWebTab) && Platform.isDesktopApp;

  const hasContext =
    uniqueNotes.length > 0 ||
    uniqueUrls.length > 0 ||
    selectedTextContexts.length > 0 ||
    contextFolders.length > 0 ||
    uniqueWebTabs.length > 0 ||
    activeNoteVisible ||
    activeWebTabVisible;

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
    <div className="tw-flex tw-w-full tw-items-start tw-gap-1">
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
          <PopoverContent className="tw-w-[400px] tw-p-0" align="start" side="top" sideOffset={4}>
            <AtMentionTypeahead
              isOpen={showTypeahead}
              onClose={handleTypeaheadClose}
              onSelect={handleTypeaheadSelect}
              isCopilotPlus={isCopilotPlus}
              currentActiveFile={currentActiveFile}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">
        {activeNoteVisible && currentActiveFile && (
          <ContextActiveNoteBadge
            currentActiveFile={currentActiveFile}
            onRemove={() => onRemoveContext("activeNote", "")}
            onClick={() => handleBadgeClick(currentActiveFile)}
          />
        )}
        {activeWebTabVisible && activeWebTab && (
          <ContextActiveWebTabBadge
            activeWebTab={activeWebTab}
            onRemove={() => onRemoveContext("activeWebTab", "")}
          />
        )}
        {uniqueNotes.map((note) => (
          <ContextNoteBadge
            key={note.path}
            note={note}
            onRemove={() => onRemoveContext("notes", note.path)}
            onClick={() => handleBadgeClick(note)}
          />
        ))}
        {uniqueUrls.map((url) => (
          <ContextUrlBadge key={url} url={url} onRemove={() => onRemoveContext("urls", url)} />
        ))}
        {contextFolders.map((folder) => (
          <ContextFolderBadge
            key={folder}
            folder={folder}
            onRemove={() => onRemoveContext("folders", folder)}
          />
        ))}
        {uniqueWebTabs.map((webTab) => (
          <ContextWebTabBadge
            key={webTab.url}
            webTab={webTab}
            onRemove={() => onRemoveContext("webTabs", webTab.url)}
          />
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
