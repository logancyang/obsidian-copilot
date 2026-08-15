import React from "react";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { TFile, TFolder } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

// Pass-through shell over ChatContextMenu (predates this file's props; kept
// as-is — inlining it into ChatInput is a standalone refactor, not something
// to piggyback on feature work).
interface ChatControlsProps {
  contextNotes: TFile[];
  includeActiveNote: boolean;
  activeNote: TFile | null;
  includeActiveWebTab: boolean;
  activeWebTab: WebTabContext | null;
  contextUrls: string[];
  contextFolders: string[];
  contextWebTabs: WebTabContext[];
  selectedTextContexts?: SelectedTextContext[];
  showIndexingCard?: () => void;
  lexicalEditorRef?: React.RefObject<{ focus: () => void }>;

  // Unified handlers
  onAddToContext: (category: string, data: TFile | string | TFolder | WebTabContext | null) => void;
  onRemoveFromContext: (category: string, data: string) => void;

  hideAddContextButton?: boolean;
  isAgentMode?: boolean;
}

export const ContextControl: React.FC<ChatControlsProps> = ({
  contextNotes,
  includeActiveNote,
  activeNote,
  includeActiveWebTab,
  activeWebTab,
  contextUrls,
  contextFolders,
  contextWebTabs,
  selectedTextContexts,
  showIndexingCard,
  lexicalEditorRef,
  onAddToContext,
  onRemoveFromContext,
  hideAddContextButton,
  isAgentMode,
}) => {
  const handleRemoveContext = (category: string, data: string) => {
    // Delegate to unified handler
    onRemoveFromContext(category, data);
  };

  const handleTypeaheadSelect = (
    category: string,
    data: TFile | string | TFolder | WebTabContext | null
  ) => {
    // Delegate to unified handler
    onAddToContext(category, data);
  };

  // Context menu is now available for all chain types

  return (
    <ChatContextMenu
      includeActiveNote={includeActiveNote}
      currentActiveFile={activeNote}
      includeActiveWebTab={includeActiveWebTab}
      activeWebTab={activeWebTab}
      contextNotes={contextNotes}
      onRemoveContext={handleRemoveContext}
      contextUrls={contextUrls}
      contextFolders={contextFolders}
      contextWebTabs={contextWebTabs}
      selectedTextContexts={selectedTextContexts}
      showIndexingCard={showIndexingCard}
      onTypeaheadSelect={handleTypeaheadSelect}
      lexicalEditorRef={lexicalEditorRef}
      hideAddContextButton={hideAddContextButton}
      isAgentMode={isAgentMode}
    />
  );
};
