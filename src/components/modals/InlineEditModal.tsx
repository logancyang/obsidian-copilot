import { useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/inlineEditCommandUtils";
import { Button } from "@/components/ui/button";
import { getModelDisplayText } from "@/components/ui/model-display";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { InlineEditCommandSettings, useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { findCustomModel, insertIntoEditor } from "@/utils";
import { Bot, Copy, PenLine } from "lucide-react";
import { App, Modal, Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface InlineEditModalContentProps {
  originalText: string;
  command: InlineEditCommandSettings;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
  onClose: () => void;
}

function InlineEditModalContent({
  originalText,
  command,
  onInsert,
  onReplace,
  onClose,
}: InlineEditModalContentProps) {
  const [aiCurrentMessage, setAiCurrentMessage] = useState<string | null>(null);
  const [processedMessage, setProcessedMessage] = useState<string | null>(null);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const [generating, setGenerating] = useState(true);
  const [modelKey] = useModelKey();
  const settings = useSettingsValue();
  const selectedModel = useMemo(
    () => findCustomModel(command.modelKey || modelKey, settings.activeModels),
    [command.modelKey, modelKey, settings.activeModels]
  );

  const commandName = command.name;
  const handleAddMessage = useCallback((message: ChatMessage) => {
    setProcessedMessage(message.message);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    async function stream() {
      const prompt = processCommandPrompt(command.prompt, originalText);
      let fullAIResponse = "";
      const chatModel = await ChatModelManager.getInstance().createModelInstance(selectedModel);
      const chatStream = await chatModel.stream(prompt);
      for await (const chunk of chatStream) {
        if (abortController?.signal.aborted) break;
        fullAIResponse += chunk.content;
        setAiCurrentMessage(fullAIResponse.trim());
      }
      if (!abortController?.signal.aborted) {
        setProcessedMessage(fullAIResponse.trim());
        setGenerating(false);
      }
    }
    stream();
    return () => {
      abortController.abort();
    };
  }, [command.prompt, originalText, handleAddMessage, selectedModel]);

  useEffect(() => {
    if (!generating) {
      replaceButtonRef.current?.focus();
    }
  }, [generating]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-60 overflow-y-auto text-muted whitespace-pre-wrap">{originalText}</div>
      <div className="flex flex-col gap-2">
        {commandName && (
          <div className="text-normal flex items-center gap-2 font-bold">
            <PenLine className="w-4 h-4" />
            {commandName}
          </div>
        )}
        <div className="text-muted flex items-center gap-2 font-bold">
          <Bot className="w-4 h-4" />
          {getModelDisplayText(selectedModel)}
        </div>
      </div>
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
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button disabled={generating} onClick={() => onInsert(processedMessage ?? "")}>
          Insert
        </Button>
        <Button
          ref={replaceButtonRef}
          disabled={generating}
          onClick={() => onReplace(processedMessage ?? "")}
        >
          Replace
        </Button>
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
      command: InlineEditCommandSettings;
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    const { selectedText, command } = this.configs;

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
        command={command}
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
