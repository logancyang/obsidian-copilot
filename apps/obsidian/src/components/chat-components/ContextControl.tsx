import React from "react";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { TFile, TFolder } from "obsidian";
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
  lexicalEditorRef?: React.RefObject<{ focus: () => void }>;

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
  lexicalEditorRef,
  onAddToContext,
  onRemoveFromContext,
  hideAddContextButton,
  isAgentMode,
}) => {
  const handleRemoveContext = (category: string, data: string) => {
    onRemoveFromContext(category, data);
  };

  const handleTypeaheadSelect = (
    category: string,
    data: TFile | string | TFolder | WebTabContext | null
  ) => {
    onAddToContext(category, data);
  };

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
      onTypeaheadSelect={handleTypeaheadSelect}
      lexicalEditorRef={lexicalEditorRef}
      hideAddContextButton={hideAddContextButton}
      isAgentMode={isAgentMode}
    />
  );
};
