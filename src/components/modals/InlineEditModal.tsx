import { useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/inlineEditCommandUtils";
import { Button } from "@/components/ui/button";
import { getModelDisplayText } from "@/components/ui/model-display";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { InlineEditCommandSettings, useSettingsValue } from "@/settings/model";
import { findCustomModel, insertIntoEditor } from "@/utils";
import { Bot, Copy, PenLine, CornerDownLeft, Command, ArrowBigUp } from "lucide-react";
import { App, Modal, Notice, Platform } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { BaseChatMemory, BufferMemory } from "langchain/memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { CustomModel } from "@/aiParams";
import { logError } from "@/logger";

// Custom hook for managing chat chain
function useChatChain(selectedModel: CustomModel) {
  const [chatMemory] = useState<BaseChatMemory>(
    new BufferMemory({ returnMessages: true, memoryKey: "history" })
  );
  const [chatChain, setChatChain] = useState<RunnableSequence | null>(null);

  // Initialize chat chain
  useEffect(() => {
    async function initChatChain() {
      const chatModel = await ChatModelManager.getInstance().createModelInstance(selectedModel);

      const chatPrompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(
          "You are a helpful assistant. You'll help the user with their content editing needs."
        ),
        new MessagesPlaceholder("history"),
        HumanMessagePromptTemplate.fromTemplate("{input}"),
      ]);

      const newChatChain = RunnableSequence.from([
        {
          input: (initialInput) => initialInput.input,
          memory: () => chatMemory.loadMemoryVariables({}),
        },
        {
          input: (previousOutput) => previousOutput.input,
          history: (previousOutput) => previousOutput.memory.history,
        },
        chatPrompt,
        chatModel,
      ]);

      setChatChain(newChatChain);
    }

    initChatChain();
  }, [selectedModel, chatMemory]);

  return { chatChain, chatMemory };
}

interface InlineEditModalContentProps {
  originalText: string;
  command: InlineEditCommandSettings;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
}

function InlineEditModalContent({
  originalText,
  command,
  onInsert,
  onReplace,
}: InlineEditModalContentProps) {
  const [aiCurrentMessage, setAiCurrentMessage] = useState<string | null>(null);
  const [processedMessage, setProcessedMessage] = useState<string | null>(null);
  const [followupInstruction, setFollowupInstruction] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const followupRef = useRef<HTMLTextAreaElement>(null);
  const [generating, setGenerating] = useState(true);
  const [modelKey] = useModelKey();
  const settings = useSettingsValue();
  const selectedModel = useMemo(
    () => findCustomModel(command.modelKey || modelKey, settings.activeModels),
    [command.modelKey, modelKey, settings.activeModels]
  );

  const { chatChain, chatMemory } = useChatChain(selectedModel);

  const commandName = command.name;

  // Reusable function to handle streaming responses wrapped in useCallback
  const streamResponse = useCallback(
    async (input: string, abortController: AbortController) => {
      if (!chatChain) {
        console.error("Chat chain not initialized");
        new Notice("Chat engine not ready. Please try again.");
        setGenerating(false);
        return null;
      }

      try {
        setAiCurrentMessage(null);
        setProcessedMessage(null);
        setGenerating(true);
        let fullResponse = "";

        const chainWithSignal = chatChain.bind({ signal: abortController.signal });

        const stream = await chainWithSignal.stream({ input });

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          const chunkContent = typeof chunk.content === "string" ? chunk.content : "";
          fullResponse += chunkContent;
          setAiCurrentMessage(fullResponse);
        }

        if (!abortController.signal.aborted) {
          const trimmedResponse = fullResponse.trim();
          setProcessedMessage(trimmedResponse);
          setGenerating(false);

          await chatMemory.saveContext({ input }, { output: trimmedResponse });

          return trimmedResponse;
        }

        return null;
      } catch (error) {
        logError("Error generating response:", error);
        setGenerating(false);
        return null;
      }
    },
    [chatChain, chatMemory]
  );

  // Generate initial response
  useEffect(() => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    async function generateInitialResponse() {
      if (!chatChain) {
        // We'll wait for the chain to be ready
        return;
      }

      try {
        const prompt = await processCommandPrompt(command.prompt, originalText);
        await streamResponse(prompt, abortController);
      } catch (error) {
        logError("Error in initial response:", error);
        setGenerating(false);
      }
    }

    generateInitialResponse();
    return () => {
      abortController.abort();
    };
  }, [command.prompt, originalText, chatChain, streamResponse]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFollowupSubmit = async () => {
    if (!followupInstruction.trim() || !chatChain) {
      if (!chatChain) {
        new Notice("Chat engine not ready. Please try again.");
      }
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Skip appending the selected text to the prompt because it's already
    // included in the original prompt.
    const prompt = await processCommandPrompt(followupInstruction, originalText, true);
    try {
      const result = await streamResponse(prompt, abortController);

      if (result) {
        // Reset follow-up instruction on success
        setFollowupInstruction("");
      }
    } finally {
      if (abortController.signal.aborted) {
        setGenerating(false);
        setProcessedMessage(aiCurrentMessage ?? "");
      }
      abortControllerRef.current = null;
    }
  };

  // Handle stopping generation
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setGenerating(false);
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;

    // For insert/replace buttons
    if (!generating && processedMessage && !showFollowupSubmit) {
      // Command+Enter (Mac) or Ctrl+Enter (Windows) for Replace
      if (e.key === "Enter" && (Platform.isMacOS ? e.metaKey : e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        onReplace(processedMessage);
      }

      // Command+Shift+Enter (Mac) or Ctrl+Shift+Enter (Windows) for Insert
      if (e.key === "Enter" && (Platform.isMacOS ? e.metaKey : e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        onInsert(processedMessage);
      }
    }

    // For submit button (follow-up instruction)
    if (showFollowupSubmit && e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleFollowupSubmit();
    }
  };

  // Scroll textarea to bottom when generating content
  useEffect(() => {
    if (textareaRef.current && aiCurrentMessage && generating) {
      const textarea = textareaRef.current;
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [aiCurrentMessage, generating]);

  // Determine if follow-up submit button should be shown
  const showFollowupSubmit = !generating && followupInstruction.trim().length > 0;

  return (
    <div className="flex flex-col gap-4" onKeyDown={handleKeyDown}>
      <div className="max-h-60 overflow-y-auto text-muted whitespace-pre-wrap">{originalText}</div>
      <div className="flex flex-col gap-2">
        {commandName && (
          <div className="text-normal flex items-center gap-2 font-bold">
            <PenLine className="w-4 h-4" />
            {commandName}
          </div>
        )}
      </div>
      <div className="relative group">
        <textarea
          ref={textareaRef}
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

      {!generating && processedMessage && (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            ref={followupRef}
            className="w-full h-20 text-text"
            placeholder="Enter follow-up instructions..."
            value={followupInstruction}
            onChange={(e) => setFollowupInstruction(e.target.value)}
          />
        </div>
      )}

      <div className="flex justify-between gap-2">
        <div className="text-faint text-xs flex items-center gap-2 font-bold">
          <Bot className="w-4 h-4" />
          {getModelDisplayText(selectedModel)}
        </div>
        <div className="flex gap-2">
          {generating ? (
            // When generating, show Stop button
            <Button variant="secondary" onClick={handleStopGeneration}>
              Stop
            </Button>
          ) : showFollowupSubmit ? (
            // When follow-up instruction has content, show Submit button with Enter shortcut
            <Button onClick={handleFollowupSubmit} className="flex items-center gap-1">
              <span>Submit</span>
              <CornerDownLeft className="size-3" />
            </Button>
          ) : (
            // Otherwise, show Insert and Replace buttons with shortcut indicators
            <>
              <Button
                onClick={() => onInsert(processedMessage ?? "")}
                className="flex items-center gap-1"
              >
                <span>Insert</span>
                <div className="flex items-center text-xs text-muted">
                  {Platform.isMacOS ? (
                    <>
                      <Command className="size-3" />
                      <ArrowBigUp className="size-3" />
                      <CornerDownLeft className="size-3" />
                    </>
                  ) : (
                    <>
                      <span className="text-xs">Ctrl</span>
                      <ArrowBigUp className="size-3" />
                      <CornerDownLeft className="size-3" />
                    </>
                  )}
                </div>
              </Button>
              <Button
                onClick={() => onReplace(processedMessage ?? "")}
                className="flex items-center gap-1"
              >
                <span>Replace</span>
                <div className="flex items-center text-xs text-muted">
                  {Platform.isMacOS ? (
                    <>
                      <Command className="size-3" />
                      <CornerDownLeft className="size-3" />
                    </>
                  ) : (
                    <>
                      <span className="text-xs">Ctrl</span>
                      <CornerDownLeft className="size-3" />
                    </>
                  )}
                </div>
              </Button>
            </>
          )}
        </div>
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

    this.root.render(
      <InlineEditModalContent
        originalText={selectedText}
        command={command}
        onInsert={handleInsert}
        onReplace={handleReplace}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
