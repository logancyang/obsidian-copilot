import { CustomModel, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { ListPromptModal } from "@/components/ListPromptModal";
import { NoteTitleModal } from "@/components/NoteTitleModal";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronUp, Command, CornerDownLeft, StopCircle } from "lucide-react";
import { App, Platform, TFile, Vault } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import ChatControls from "./ChatControls";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: () => void;
  isGenerating: boolean;
  chatIsVisible: boolean;
  onStopGenerating: () => void;
  app: App;
  settings: CopilotSettings;
  navigateHistory: (direction: "up" | "down") => string;
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  addMessage: (message: ChatMessage) => void;
  vault: Vault;
  vault_qa_strategy: string;
  isIndexLoadedPromise: Promise<boolean>;
  debug?: boolean;
}

const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

const ChatInput: React.FC<ChatInputProps> = ({
  inputMessage,
  setInputMessage,
  handleSendMessage,
  isGenerating,
  onStopGenerating,
  app,
  settings,
  navigateHistory,
  chatIsVisible,
  currentModelKey,
  setCurrentModelKey,
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  addMessage,
  vault,
  vault_qa_strategy,
  isIndexLoadedPromise,
  debug,
}) => {
  const [shouldFocus, setShouldFocus] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleInputChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = event.target.value;
    const cursorPos = event.target.selectionStart;

    setInputMessage(inputValue);
    adjustTextareaHeight();

    if (cursorPos >= 2 && inputValue.slice(cursorPos - 2, cursorPos) === "[[") {
      showNoteTitleModal(cursorPos);
    } else if (inputValue === "/") {
      showCustomPromptModal();
    }
  };

  const adjustTextareaHeight = () => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = "auto"; // Reset height
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`; // Adjust height
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputMessage]);

  const showNoteTitleModal = (cursorPos: number) => {
    const fetchNoteTitles = async () => {
      const noteTitles = app.vault.getMarkdownFiles().map((file: TFile) => file.basename);

      new NoteTitleModal(app, noteTitles, (noteTitle: string) => {
        const before = inputMessage.slice(0, cursorPos - 2);
        const after = inputMessage.slice(cursorPos - 1);
        setInputMessage(`${before}[[${noteTitle}]]${after}`);
        // Add a delay to ensure the cursor is set after inputMessage is updated
        setTimeout(() => {
          if (textAreaRef.current) {
            const newCursorPos = cursorPos + noteTitle.length + 2;
            textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }).open();
    };

    fetchNoteTitles();
  };

  const showCustomPromptModal = async () => {
    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
    const prompts = await customPromptProcessor.getAllPrompts();
    const promptTitles = prompts.map((prompt) => prompt.title);

    new ListPromptModal(app, promptTitles, async (promptTitle: string) => {
      const selectedPrompt = prompts.find((prompt) => prompt.title === promptTitle);
      if (selectedPrompt) {
        await customPromptProcessor.recordPromptUsage(selectedPrompt.title);
        setInputMessage(selectedPrompt.content);
      }
    }).open();
  };

  useEffect(() => {
    setShouldFocus(chatIsVisible);
  }, [chatIsVisible]);

  useEffect(() => {
    if (textAreaRef.current && shouldFocus) {
      textAreaRef.current.focus();
    }
  }, [shouldFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;

    const textarea = textAreaRef.current;
    if (!textarea) return;

    const { selectionStart, value } = textarea;
    const lines = value.split("\n");
    const currentLineIndex = value.substring(0, selectionStart).split("\n").length - 1;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
      setHistoryIndex(-1);
      setTempInput("");
    } else if (e.key === "ArrowUp") {
      if (currentLineIndex > 0 || selectionStart > 0) {
        // Allow normal cursor movement within multi-line input
        return;
      }
      e.preventDefault();
      if (historyIndex === -1 && value.trim() !== "") {
        setTempInput(value);
      }
      const newMessage = navigateHistory("up");
      if (newMessage !== inputMessage) {
        setHistoryIndex(historyIndex + 1);
        setInputMessage(newMessage);
        // Set cursor to beginning of input after update
        setTimeout(() => {
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = 0;
          }
        }, 0);
      }
    } else if (e.key === "ArrowDown") {
      if (currentLineIndex < lines.length - 1 || selectionStart < value.length) {
        // Allow normal cursor movement within multi-line input
        return;
      }
      e.preventDefault();
      if (historyIndex > -1) {
        const newMessage = navigateHistory("down");
        setHistoryIndex(historyIndex - 1);
        if (historyIndex === 0) {
          setInputMessage(tempInput);
        } else {
          setInputMessage(newMessage);
        }
        // Set cursor to beginning of input after update
        setTimeout(() => {
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = 0;
          }
        }, 0);
      }
    }
  };

  return (
    <div className="chat-input-container" ref={containerRef}>
      <ChatControls
        currentChain={currentChain}
        setCurrentChain={setCurrentChain}
        onNewChat={onNewChat}
        onSaveAsNote={onSaveAsNote}
        onRefreshVaultContext={onRefreshVaultContext}
        settings={settings}
        vault_qa_strategy={vault_qa_strategy}
        isIndexLoadedPromise={isIndexLoadedPromise}
        debug={debug}
      />

      <textarea
        ref={textAreaRef}
        className="chat-input-textarea"
        placeholder="Ask anything. [[ for notes. / for custom prompts."
        value={inputMessage}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />

      <div className="chat-input-controls">
        <DropdownMenu.Root open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen}>
          <DropdownMenu.Trigger className="model-select-button">
            {settings.activeModels.find((model) => getModelKey(model) === currentModelKey)?.name ||
              "Select Model"}
            <ChevronUp size={10} />
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="model-select-content" align="start">
              {settings.activeModels
                .filter((model) => model.enabled)
                .map((model) => (
                  <DropdownMenu.Item
                    key={getModelKey(model)}
                    onSelect={() => setCurrentModelKey(getModelKey(model))}
                  >
                    {model.name}
                  </DropdownMenu.Item>
                ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <div className="chat-input-buttons">
          {isGenerating && (
            <button onClick={() => onStopGenerating()} className="submit-button cancel">
              <StopCircle />
            </button>
          )}
          <button onClick={handleSendMessage} className="submit-button">
            <CornerDownLeft size={16} />
            <span>chat</span>
          </button>

          {currentChain === "copilot_plus" && (
            <button onClick={handleSendMessage} className="submit-button vault">
              <div className="button-content">
                {Platform.isMacOS && <Command size={12} />}
                <CornerDownLeft size={16} />
                <span>vault</span>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
