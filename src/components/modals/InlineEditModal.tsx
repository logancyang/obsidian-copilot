import { COMMAND_NAMES, CommandId } from "@/constants";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { insertIntoEditor } from "@/utils";
import { Copy, PenLine } from "lucide-react";
import { App, Modal, Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface InlineEditModalContentProps {
  originalText: string;
  promptMessage: ChatMessage;
  chainManager: ChainManager;
  commandId: CommandId;
  customTemperature?: number;
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
      <div className="relative group">
        <textarea
          className="w-full h-60 text-text peer"
          value={processedMessage ?? aiCurrentMessage ?? "loading..."}
          disabled={processedMessage == null}
          onChange={(e) => setProcessedMessage(e.target.value)}
        />
        {processedMessage && (
          <button
            className="absolute top-2 right-2 opacity-0 peer-focus-visible:!opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => {
              navigator.clipboard.writeText(processedMessage);
              new Notice("Copied to clipboard");
            }}
          >
            <Copy className="w-4 h-4 text-muted-foreground hover:text-accent" />
          </button>
        )}
      </div>
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
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    const { selectedText, commandId, promptMessage, chainManager } = this.configs;

    const handleInsert = (message: string) => {
      insertIntoEditor(message);
      this.close();
    };

    const handleReplace = (message: string) => {
      insertIntoEditor(message, true);
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
