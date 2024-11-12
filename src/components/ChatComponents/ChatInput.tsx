import { CustomModel, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { ListPromptModal } from "@/components/ListPromptModal";
import { NoteTitleModal } from "@/components/NoteTitleModal";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { COPILOT_TOOL_NAMES } from "@/LLMProviders/intentAnalyzer";
import { Mention } from "@/mentions/Mention";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { extractNoteTitles } from "@/utils";
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
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  mention: Mention;
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
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  mention,
  debug,
}) => {
  const [shouldFocus, setShouldFocus] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [contextUrls, setContextUrls] = useState<string[]>([]);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debounce = <T extends (...args: any[]) => any>(
    fn: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  };

  // Debounce the context update to prevent excessive re-renders
  const debouncedUpdateContext = debounce(
    async (
      inputValue: string,
      setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>,
      currentContextNotes: TFile[],
      includeActiveNote: boolean,
      app: App
    ) => {
      const noteTitles = extractNoteTitles(inputValue);
      const notesToAdd = await Promise.all(
        noteTitles.map(async (title) => {
          const files = app.vault.getMarkdownFiles();
          const file = files.find((file) => file.basename === title);
          if (file) {
            // Create a new object that extends TFile with our flag
            return Object.assign(file, { wasAddedViaReference: true }) as TFile & {
              wasAddedViaReference: boolean;
            };
          }
          return undefined;
        })
      );

      const activeNote = app.workspace.getActiveFile();
      const validNotes = notesToAdd.filter(
        (note): note is TFile & { wasAddedViaReference: boolean } =>
          note !== undefined &&
          !currentContextNotes.some((existing) => existing.path === note.path) &&
          (!includeActiveNote || activeNote?.path !== note.path)
      );

      if (validNotes.length > 0) {
        setContextNotes((prev) => [...prev, ...validNotes]);
      }
    },
    300
  );

  const handleInputChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = event.target.value;
    const cursorPos = event.target.selectionStart;

    setInputMessage(inputValue);
    adjustTextareaHeight();

    // Extract URLs and update mentions
    const urls = mention.extractUrls(inputValue);

    // Update URLs in context, ensuring uniqueness
    const newUrls = urls.filter((url) => !contextUrls.includes(url));
    if (newUrls.length > 0) {
      // Use Set to ensure uniqueness
      setContextUrls((prev) => Array.from(new Set([...prev, ...newUrls])));
    }

    // Update context with debouncing
    debouncedUpdateContext(inputValue, setContextNotes, contextNotes, includeActiveNote, app);

    // Handle other input triggers
    if (cursorPos >= 2 && inputValue.slice(cursorPos - 2, cursorPos) === "[[") {
      showNoteTitleModal(cursorPos);
    } else if (inputValue === "/") {
      showCustomPromptModal();
    } else if (inputValue.slice(-1) === "@" && currentChain === ChainType.COPILOT_PLUS_CHAIN) {
      showCopilotPlusOptionsModal();
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

      new NoteTitleModal(app, noteTitles, async (noteTitle: string) => {
        const before = inputMessage.slice(0, cursorPos - 2);
        const after = inputMessage.slice(cursorPos - 1);
        const newInputMessage = `${before}[[${noteTitle}]]${after}`;
        setInputMessage(newInputMessage);

        const activeNote = app.workspace.getActiveFile();
        // Immediately update context without waiting for debounce
        const noteFile = app.vault.getMarkdownFiles().find((file) => file.basename === noteTitle);
        if (
          noteFile &&
          !contextNotes.some((existing) => existing.path === noteFile.path) &&
          (!includeActiveNote || activeNote?.path !== noteFile.path)
        ) {
          if (activeNote && noteFile.path === activeNote.path) {
            setIncludeActiveNote(true);
          } else {
            // Add the wasAddedViaReference flag here too
            setContextNotes((prev) => [
              ...prev,
              Object.assign(noteFile, { wasAddedViaReference: true }),
            ]);
          }
        }

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

  const showCopilotPlusOptionsModal = () => {
    const options = COPILOT_TOOL_NAMES;
    new ListPromptModal(app, options, (selectedOption: string) => {
      setInputMessage(inputMessage + selectedOption + " ");
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

  useEffect(() => {
    // Extract current note titles and URLs from input
    const currentTitles = new Set(extractNoteTitles(inputMessage));
    const currentUrls = mention.extractUrls(inputMessage);
    const activeNote = app.workspace.getActiveFile();

    // Remove notes that were added via [[]] references and are no longer in the input
    setContextNotes((prev) =>
      prev.filter((note) => {
        // Check if the note was added via reference
        const wasAddedViaReference = "wasAddedViaReference" in note;

        return (
          // Keep the note if it's still referenced in the input
          currentTitles.has(note.basename) ||
          // Keep the active note if it's included
          (includeActiveNote && activeNote?.path === note.path) ||
          // Keep the note if it wasn't added via reference
          !wasAddedViaReference
        );
      })
    );

    // Remove URLs that are no longer in the input
    setContextUrls((prev) => prev.filter((url) => currentUrls.includes(url)));
  }, [inputMessage]);

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
        app={app}
        contextNotes={contextNotes}
        setContextNotes={setContextNotes}
        includeActiveNote={includeActiveNote}
        setIncludeActiveNote={setIncludeActiveNote}
        contextUrls={contextUrls}
        onRemoveUrl={(url: string) => setContextUrls((prev) => prev.filter((u) => u !== url))}
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
