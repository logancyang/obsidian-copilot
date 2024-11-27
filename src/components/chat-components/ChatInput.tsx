import { CustomModel, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { AddImageModal } from "@/components/modals/AddImageModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { NoteTitleModal } from "@/components/modals/NoteTitleModal";
import { ContextProcessor } from "@/contextProcessor";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { COPILOT_TOOL_NAMES } from "@/LLMProviders/intentAnalyzer";
import { Mention } from "@/mentions/Mention";
import { useSettingsValueContext } from "@/settings/contexts/SettingsValueContext";
import { ChatMessage } from "@/sharedState";
import { getToolDescription } from "@/tools/toolManager";
import { extractNoteTitles } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowBigUp, ChevronUp, Command, CornerDownLeft, Image, StopCircle } from "lucide-react";
import { App, Platform, TFile } from "obsidian";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ChatControls from "./ChatControls";
import { TooltipActionButton } from "./TooltipActionButton";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: (toolCalls?: string[]) => void;
  isGenerating: boolean;
  onStopGenerating: () => void;
  app: App;
  navigateHistory: (direction: "up" | "down") => string;
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  isIndexLoadedPromise: Promise<boolean>;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  mention: Mention;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  chatHistory: ChatMessage[];
  debug?: boolean;
}

const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

const ChatInput = forwardRef<{ focus: () => void }, ChatInputProps>(
  (
    {
      inputMessage,
      setInputMessage,
      handleSendMessage,
      isGenerating,
      onStopGenerating,
      app,
      navigateHistory,
      currentModelKey,
      setCurrentModelKey,
      currentChain,
      setCurrentChain,
      onNewChat,
      onSaveAsNote,
      onRefreshVaultContext,
      isIndexLoadedPromise,
      contextNotes,
      setContextNotes,
      includeActiveNote,
      setIncludeActiveNote,
      mention,
      selectedImages,
      onAddImage,
      setSelectedImages,
      chatHistory,
      debug,
    },
    ref
  ) => {
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [tempInput, setTempInput] = useState("");
    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
    const [contextUrls, setContextUrls] = useState<string[]>([]);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const settings = useSettingsValueContext();

    useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
    }));

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
        app: App
      ) => {
        const noteTitles = extractNoteTitles(inputValue);

        const notesToAdd = await Promise.all(
          noteTitles.map(async (title) => {
            const files = app.vault.getMarkdownFiles();
            const file = files.find((file) => file.basename === title);
            if (file) {
              return Object.assign(file, { wasAddedViaReference: true }) as TFile & {
                wasAddedViaReference: boolean;
              };
            }
            return undefined;
          })
        );

        const validNotes = notesToAdd.filter(
          (note): note is TFile & { wasAddedViaReference: boolean } =>
            note !== undefined &&
            !currentContextNotes.some((existing) => existing.path === note.path)
        );

        if (validNotes.length > 0) {
          setContextNotes((prev) => [...prev, ...validNotes]);
        }
      },
      50
    );

    const handleInputChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const inputValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInputMessage(inputValue);
      adjustTextareaHeight();

      // Extract URLs and update mentions
      const urls = mention.extractAllUrls(inputValue);

      // Update URLs in context, ensuring uniqueness
      const newUrls = urls.filter((url) => !contextUrls.includes(url));
      if (newUrls.length > 0) {
        // Use Set to ensure uniqueness
        setContextUrls((prev) => Array.from(new Set([...prev, ...newUrls])));
      }

      // Update context with debouncing
      debouncedUpdateContext(inputValue, setContextNotes, contextNotes, app);

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
        const contextProcessor = ContextProcessor.getInstance();

        new NoteTitleModal(app, noteTitles, async (noteTitle: string) => {
          const before = inputMessage.slice(0, cursorPos - 2);
          const after = inputMessage.slice(cursorPos - 1);
          const newInputMessage = `${before}[[${noteTitle}]]${after}`;
          setInputMessage(newInputMessage);

          // Manually invoke debouncedUpdateContext
          debouncedUpdateContext(newInputMessage, setContextNotes, contextNotes, app);

          const activeNote = app.workspace.getActiveFile();
          const noteFile = app.vault.getMarkdownFiles().find((file) => file.basename === noteTitle);

          if (noteFile) {
            await contextProcessor.addNoteToContext(
              noteFile,
              app.vault,
              contextNotes,
              activeNote,
              setContextNotes,
              setIncludeActiveNote
            );
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
      // Create a map of options with their descriptions
      const optionsWithDescriptions = COPILOT_TOOL_NAMES.map((option) => ({
        title: option,
        description: getToolDescription(option),
      }));

      new ListPromptModal(
        app,
        optionsWithDescriptions.map((o) => o.title),
        (selectedOption: string) => {
          setInputMessage(inputMessage + selectedOption + " ");
        },
        // Add descriptions as a separate array
        optionsWithDescriptions.map((o) => o.description)
      ).open();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;

      const textarea = textAreaRef.current;
      if (!textarea) return;

      const { selectionStart, value } = textarea;
      const lines = value.split("\n");
      const currentLineIndex = value.substring(0, selectionStart).split("\n").length - 1;

      // Check for Cmd+Shift+Enter (Mac) or Ctrl+Shift+Enter (Windows)
      if (e.key === "Enter" && e.shiftKey && (Platform.isMacOS ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();

        if (currentChain === ChainType.COPILOT_PLUS_CHAIN) {
          handleSendMessage(["@vault"]);
        } else {
          handleSendMessage();
        }
        setHistoryIndex(-1);
        setTempInput("");
        return;
      }

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
      // Get all note titles that are referenced using [[note]] syntax in the input
      const currentTitles = new Set(extractNoteTitles(inputMessage));
      // Get all URLs mentioned in the input
      const currentUrls = mention.extractAllUrls(inputMessage);
      // Get the currently open note in the editor
      const activeNote = app.workspace.getActiveFile();

      setContextNotes((prev) =>
        prev.filter((note) => {
          // Check if this note was added manually via the "+" button
          const wasAddedManually = (note as any).wasAddedManually === true;
          // If it was added manually, always keep it
          if (wasAddedManually) return true;

          // Check if this note was added by typing [[note]] in the input
          // as opposed to being added via the "Add Note to Context" button
          const wasAddedViaReference = (note as any).wasAddedViaReference === true;

          // Special handling for the active note
          if (note.path === activeNote?.path) {
            if (wasAddedViaReference) {
              // Case 1: Active note was added by typing [[note]]
              // Keep it only if its title is still in the input
              // This ensures it's removed when you delete the [[note]] reference
              return currentTitles.has(note.basename);
            } else {
              // Case 2: Active note was NOT added by [[note]], but by the includeActiveNote toggle
              // Keep it only if includeActiveNote is true
              // This handles the "Include active note" toggle in the UI
              return includeActiveNote;
            }
          } else {
            // Handling for all other notes (not the active note)
            if (wasAddedViaReference) {
              // Case 3: Other note was added by typing [[note]]
              // Keep it only if its title is still in the input
              // This ensures it's removed when you delete the [[note]] reference
              return currentTitles.has(note.basename);
            } else {
              // Case 4: Other note was added via "Add Note to Context" button
              // Always keep these notes as they were manually added
              return true;
            }
          }
        })
      );

      // Remove any URLs that are no longer present in the input
      setContextUrls((prev) => prev.filter((url) => currentUrls.includes(url)));
    }, [inputMessage, includeActiveNote]);

    return (
      <div className="chat-input-container" ref={containerRef}>
        <ChatControls
          currentChain={currentChain}
          setCurrentChain={setCurrentChain}
          onNewChat={onNewChat}
          onSaveAsNote={onSaveAsNote}
          onRefreshVaultContext={onRefreshVaultContext}
          isIndexLoadedPromise={isIndexLoadedPromise}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          contextUrls={contextUrls}
          onRemoveUrl={(url: string) => setContextUrls((prev) => prev.filter((u) => u !== url))}
          chatHistory={chatHistory}
          debug={debug}
        />

        {selectedImages.length > 0 && (
          <div className="selected-images">
            {selectedImages.map((file, index) => (
              <div key={index} className="image-preview-container">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="selected-image-preview"
                />
                <button
                  className="remove-image-button"
                  onClick={() => setSelectedImages((prev) => prev.filter((_, i) => i !== index))}
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textAreaRef}
          className="chat-input-textarea"
          placeholder="Ask anything. [[ for notes. / for custom prompts."
          value={inputMessage}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-controls">
          <div className="chat-input-left">
            <DropdownMenu.Root open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen}>
              <DropdownMenu.Trigger className="model-select-button">
                {settings.activeModels.find((model) => getModelKey(model) === currentModelKey)
                  ?.name || "Select Model"}
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

            {currentChain === ChainType.COPILOT_PLUS_CHAIN && (
              <TooltipActionButton
                onClick={() => {
                  new AddImageModal(app, onAddImage).open();
                }}
                Icon={
                  <div className="button-content">
                    <span>image</span>
                    <Image className="icon-scaler" />
                  </div>
                }
              >
                Add Image
              </TooltipActionButton>
            )}
          </div>

          <div className="chat-input-buttons">
            {isGenerating && (
              <button onClick={() => onStopGenerating()} className="submit-button cancel">
                <StopCircle />
              </button>
            )}
            <button onClick={() => handleSendMessage()} className="submit-button">
              <CornerDownLeft size={16} />
              <span>chat</span>
            </button>

            {currentChain === "copilot_plus" && (
              <button onClick={() => handleSendMessage(["@vault"])} className="submit-button vault">
                <div className="button-content">
                  {Platform.isMacOS ? (
                    <>
                      <Command size={12} />
                      <ArrowBigUp size={16} />
                      <CornerDownLeft size={16} />
                    </>
                  ) : (
                    <>
                      <span>Ctrl</span>
                      <ArrowBigUp size={16} />
                      <CornerDownLeft size={16} />
                    </>
                  )}
                  <span>vault</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;
