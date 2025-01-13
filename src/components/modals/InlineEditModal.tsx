import { COMMAND_NAMES, CommandId } from "@/constants";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { PenLine } from "lucide-react";
import { App, Modal } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface InlineEditModalContentProps {
  originalText: string;
  promptMessage: ChatMessage;
  chainManager: ChainManager;
  commandId: CommandId;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
  onClose: () => void;
}

function InlineEditModalContent({
  originalText,
  promptMessage,
  chainManager,
  commandId,
  onInsert,
  onReplace,
  onClose,
}: InlineEditModalContentProps) {
  const [aiCurrentMessage, setAiCurrentMessage] = useState<string | null>(null);
  const [processedMessage, setProcessedMessage] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const commandName = COMMAND_NAMES[commandId];
  const handleAddMessage = useCallback((message: ChatMessage) => {
    setProcessedMessage(message.message);
  }, []);

  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort();
      }
    };
  }, [abortController]);

  useEffect(() => {
    getAIResponse(
      promptMessage,
      chainManager,
      handleAddMessage,
      setAiCurrentMessage,
      setAbortController,
      {
        debug: getSettings().debug,
        ignoreSystemMessage: true,
      }
    );
  }, [promptMessage, chainManager, handleAddMessage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-60 overflow-y-auto text-muted whitespace-pre-wrap">{originalText}</div>
      {commandName && (
        <div className="text-normal flex items-center gap-2 font-bold">
          <PenLine className="w-4 h-4" />
          {commandName}
        </div>
      )}
      <textarea
        className="w-full h-60 text-text"
        value={processedMessage ?? aiCurrentMessage ?? "loading..."}
        disabled={processedMessage == null}
        onChange={(e) => setProcessedMessage(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose}>Close</button>
        <button
          disabled={processedMessage == null}
          className="!bg-interactive-accent !text-on-accent cursor-pointer"
          onClick={() => onInsert(processedMessage ?? "")}
        >
          Insert
        </button>
        <button
          disabled={processedMessage == null}
          className="!bg-interactive-accent !text-on-accent cursor-pointer"
          onClick={() => onReplace(processedMessage ?? "")}
        >
          Replace
        </button>
      </div>
    </div>
  );
}

export class InlineEditModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private configs: {
      selectedText: string;
      commandId: CommandId;
      promptMessage: ChatMessage;
      chainManager: ChainManager;
      onInsert: (message: string) => void;
      onReplace: (message: string) => void;
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    const { selectedText, commandId, promptMessage, chainManager, onInsert, onReplace } =
      this.configs;

    const handleInsert = (message: string) => {
      onInsert(message);
      this.close();
    };

    const handleReplace = (message: string) => {
      onReplace(message);
      this.close();
    };

    const handleClose = () => {
      this.close();
    };

    this.root.render(
      <InlineEditModalContent
        originalText={selectedText}
        promptMessage={promptMessage}
        chainManager={chainManager}
        commandId={commandId}
        onInsert={handleInsert}
        onReplace={handleReplace}
        onClose={handleClose}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
