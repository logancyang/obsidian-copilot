import React from "react";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

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
  showProgressCard: () => void;
  showIndexingCard?: () => void;
  lexicalEditorRef?: React.RefObject<any>;

  // Unified handlers
  onAddToContext: (category: string, data: any) => void;
  onRemoveFromContext: (category: string, data: any) => void;
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
  showProgressCard,
  showIndexingCard,
  lexicalEditorRef,
  onAddToContext,
  onRemoveFromContext,
}) => {
  const handleRemoveContext = (category: string, data: any) => {
    // Delegate to unified handler
    onRemoveFromContext(category, data);
  };

  const handleTypeaheadSelect = (category: string, data: any) => {
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
      showProgressCard={showProgressCard}
      showIndexingCard={showIndexingCard}
      onTypeaheadSelect={handleTypeaheadSelect}
      lexicalEditorRef={lexicalEditorRef}
    />
  );
};
