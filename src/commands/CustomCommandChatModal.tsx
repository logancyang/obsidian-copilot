import { CustomModel, useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { Button } from "@/components/ui/button";
import { getModelDisplayText } from "@/components/ui/model-display";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { logError } from "@/logger";
import { findCustomModel, insertIntoEditor } from "@/utils";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseChatMemory, BufferMemory } from "@langchain/classic/memory";
import { ArrowBigUp, Bot, Command, Copy, CornerDownLeft, PenLine } from "lucide-react";
import { App, Modal, Notice, Platform } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { CustomCommand } from "@/commands/type";
import { useSettingsValue } from "@/settings/model";

// Custom hook for managing chat chain
function useChatChain(selectedModel: CustomModel, systemPrompt?: string) {
  const [chatMemory] = useState<BaseChatMemory>(
    new BufferMemory({ returnMessages: true, memoryKey: "history" })
  );
  const [chatChain, setChatChain] = useState<RunnableSequence | null>(null);

  // Initialize chat chain
  useEffect(() => {
    async function initChatChain() {
      const chatModel = await ChatModelManager.getInstance().createModelInstance(selectedModel);

      const defaultSystemPrompt =
        "You are a helpful assistant. You'll help the user with their content editing needs.";
      const chatPrompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(systemPrompt || defaultSystemPrompt),
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
  }, [selectedModel, chatMemory, systemPrompt]);

  return { chatChain, chatMemory };
}

interface CustomCommandChatModalContentProps {
  originalText: string;
  command: CustomCommand;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
  systemPrompt?: string;
}

function CustomCommandChatModalContent({
  originalText,
  command,
  onInsert,
  onReplace,
  systemPrompt,
}: CustomCommandChatModalContentProps) {
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

  const { chatChain, chatMemory } = useChatChain(selectedModel, systemPrompt);

  const commandTitle = command.title;

  /**
   * Helper function to check if content has unclosed think block
   * Returns true if currently in thinking phase
   */
  const isInThinkingPhase = (content: string | null): boolean => {
    if (!content) return false;
    const openTags = (content.match(/<think>/g) || []).length;
    const closeTags = (content.match(/<\/think>/g) || []).length;
    return openTags > closeTags;
  };

  /**
   * Remove all <think>...</think> blocks from content
   */
  const removeThinkingBlocks = (content: string): string => {
    return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  };

  /**
   * Compute the display value for the textarea
   */
  const displayValue = useMemo(() => {
    // If we have a processed message, show that
    if (processedMessage) {
      return processedMessage;
    }

    // If not generating, show loading
    if (!generating) {
      return "loading...";
    }

    // If generating but no content yet, show loading
    if (!aiCurrentMessage || aiCurrentMessage.trim() === "") {
      return "loading...";
    }

    // If currently in thinking phase, show thinking
    if (isInThinkingPhase(aiCurrentMessage)) {
      return "thinking...";
    }

    // Otherwise show the streaming content
    return aiCurrentMessage;
  }, [processedMessage, generating, aiCurrentMessage]);

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

        const chainWithSignal = chatChain.withConfig({ signal: abortController.signal });

        const stream = await chainWithSignal.stream({ input });

        // Initialize ThinkBlockStreamer to handle reasoning content from Claude, Deepseek, and GPT-5
        const thinkStreamer = new ThinkBlockStreamer((message: string) => {
          setAiCurrentMessage(message);
        });

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          thinkStreamer.processChunk(chunk);
        }

        // Close the streamer to finalize the response and close any open think blocks
        const result = thinkStreamer.close();

        if (!abortController.signal.aborted) {
          const trimmedResponse = result.content.trim();
          // Remove thinking blocks from the final response
          const cleanedResponse = removeThinkingBlocks(trimmedResponse);
          setProcessedMessage(cleanedResponse);
          setGenerating(false);

          await chatMemory.saveContext({ input }, { output: cleanedResponse });

          return cleanedResponse;
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
        const prompt = await processCommandPrompt(command.content, originalText);
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
  }, [command.content, originalText, chatChain, streamResponse]);

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
        // Remove thinking blocks from the aborted response too
        const cleanedMessage = aiCurrentMessage ? removeThinkingBlocks(aiCurrentMessage) : "";
        setProcessedMessage(cleanedMessage);
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
    <div className="tw-flex tw-flex-col tw-gap-4" onKeyDown={handleKeyDown}>
      <div className="tw-max-h-60 tw-overflow-y-auto tw-whitespace-pre-wrap tw-text-muted">
        {originalText}
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        {commandTitle && (
          <div className="tw-flex tw-items-center tw-gap-2 tw-font-bold tw-text-normal">
            <PenLine className="tw-size-4" />
            {commandTitle}
          </div>
        )}
      </div>
      <div className="tw-group tw-relative">
        <textarea
          ref={textareaRef}
          className="tw-peer tw-h-60 tw-w-full tw-text-text"
          value={displayValue}
          disabled={processedMessage == null}
          onChange={(e) => setProcessedMessage(e.target.value)}
        />
        {processedMessage && (
          <button
            className="tw-absolute tw-right-2 tw-top-2 tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100 peer-focus-visible:!tw-opacity-0"
            onClick={() => {
              navigator.clipboard.writeText(processedMessage);
              new Notice("Copied to clipboard");
            }}
          >
            <Copy className="tw-size-4 hover:tw-text-accent" />
          </button>
        )}
      </div>

      {!generating && processedMessage && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <textarea
            autoFocus
            ref={followupRef}
            className="tw-h-20 tw-w-full tw-text-text"
            placeholder="Enter follow-up instructions..."
            value={followupInstruction}
            onChange={(e) => setFollowupInstruction(e.target.value)}
          />
        </div>
      )}

      <div className="tw-flex tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-font-bold tw-text-faint">
          <Bot className="tw-size-4" />
          {getModelDisplayText(selectedModel)}
        </div>
        <div className="tw-flex tw-gap-2">
          {generating ? (
            // When generating, show Stop button
            <Button size="sm" variant="secondary" onClick={handleStopGeneration}>
              Stop
            </Button>
          ) : showFollowupSubmit ? (
            // When follow-up instruction has content, show Submit button with Enter shortcut
            <Button
              size="sm"
              onClick={handleFollowupSubmit}
              className="tw-flex tw-items-center tw-gap-1"
            >
              <span>Submit</span>
              <CornerDownLeft className="tw-size-3" />
            </Button>
          ) : (
            // Otherwise, show Insert and Replace buttons with shortcut indicators
            <>
              <Button
                size="sm"
                onClick={() => onInsert(processedMessage ?? "")}
                className="tw-flex tw-items-center tw-gap-1"
              >
                <span>Insert</span>
                <div className="tw-flex tw-items-center tw-text-xs">
                  {Platform.isMacOS ? (
                    <>
                      <Command className="tw-size-3" />
                      <ArrowBigUp className="tw-size-3" />
                      <CornerDownLeft className="tw-size-3" />
                    </>
                  ) : (
                    <>
                      <span className="tw-text-xs">Ctrl</span>
                      <ArrowBigUp className="tw-size-3" />
                      <CornerDownLeft className="tw-size-3" />
                    </>
                  )}
                </div>
              </Button>
              <Button
                size="sm"
                onClick={() => onReplace(processedMessage ?? "")}
                className="tw-flex tw-items-center tw-gap-1"
              >
                <span>Replace</span>
                <div className="tw-flex tw-items-center tw-text-xs">
                  {Platform.isMacOS ? (
                    <>
                      <Command className="tw-size-3" />
                      <CornerDownLeft className="tw-size-3" />
                    </>
                  ) : (
                    <>
                      <span className="tw-text-xs">Ctrl</span>
                      <CornerDownLeft className="tw-size-3" />
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

export class CustomCommandChatModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private configs: {
      selectedText: string;
      command: CustomCommand;
      systemPrompt?: string;
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    const { selectedText, command, systemPrompt } = this.configs;

    const handleInsert = (message: string) => {
      insertIntoEditor(message);
      this.close();
    };

    const handleReplace = (message: string) => {
      insertIntoEditor(message, true);
      this.close();
    };

    this.root.render(
      <CustomCommandChatModalContent
        originalText={selectedText}
        command={command}
        onInsert={handleInsert}
        onReplace={handleReplace}
        systemPrompt={systemPrompt}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
