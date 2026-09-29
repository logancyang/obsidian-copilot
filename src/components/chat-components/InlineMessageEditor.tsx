import React, { useState, useCallback } from "react";
import { TFile, App } from "obsidian";
import ChatInput from "./ChatModeInput";
import type { ChatMessage, ChatMessageView } from "@/types/message";
import { useActiveWebTabState } from "./hooks/useActiveWebTabState";
import { appendUniqueFiles } from "@/utils/fileListUtils";

interface InlineMessageEditorProps {
  initialValue: string;
  initialContext?: ChatMessageView["context"];
  onSave: (newText: string, newContext: ChatMessage["context"]) => void;
  onCancel: () => void;
  app: App;
}

export const InlineMessageEditor: React.FC<InlineMessageEditorProps> = ({
  initialValue,
  initialContext,
  onSave,
  onCancel,
  app,
}) => {
  const [inputMessage, setInputMessage] = useState(initialValue);

  const [contextNotes, setContextNotes] = useState<TFile[]>(
    initialContext?.notes?.filter((note): note is TFile => note instanceof TFile) || []
  );
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [includeActiveWebTab, setIncludeActiveWebTab] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const { activeWebTabForMentions: currentActiveWebTab } = useActiveWebTabState();

  const handleEditSave = useCallback(
    (
      text: string,
      context: {
        notes: TFile[];
        urls: string[];
        tags: string[];
        folders: string[];
      }
    ) => {
      const newContext: ChatMessage["context"] = {
        notes: context.notes,
        urls: context.urls,
        tags: context.tags,
        folders: context.folders,
        selectedTextContexts: initialContext?.selectedTextContexts || [],
      };

      onSave(text, newContext);
    },
    [onSave, initialContext?.selectedTextContexts]
  );

  const handleEditCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleSendMessage = useCallback(() => {}, []);

  const handleStopGenerating = useCallback(() => {}, []);

  const handleAddImage = useCallback((files: File[]) => {
    setSelectedImages((prev) => appendUniqueFiles(prev, files));
  }, []);

  const handleRemoveSelectedText = useCallback((id: string) => {}, []);

  const initialChatInputContext = {
    notes: contextNotes,
    urls: initialContext?.urls || [],
    tags: initialContext?.tags || [],
    folders: initialContext?.folders || [],
  };

  return (
    <ChatInput
      inputMessage={inputMessage}
      setInputMessage={setInputMessage}
      handleSendMessage={handleSendMessage}
      isGenerating={false}
      onStopGenerating={handleStopGenerating}
      app={app}
      contextNotes={contextNotes}
      setContextNotes={setContextNotes}
      includeActiveNote={includeActiveNote}
      setIncludeActiveNote={setIncludeActiveNote}
      includeActiveWebTab={includeActiveWebTab}
      setIncludeActiveWebTab={setIncludeActiveWebTab}
      activeWebTab={currentActiveWebTab}
      selectedImages={selectedImages}
      onAddImage={handleAddImage}
      setSelectedImages={setSelectedImages}
      disableModelSwitch={false}
      selectedTextContexts={initialContext?.selectedTextContexts}
      onRemoveSelectedText={handleRemoveSelectedText}
      editMode={true}
      onEditSave={handleEditSave}
      onEditCancel={handleEditCancel}
      initialContext={initialChatInputContext}
    />
  );
};
