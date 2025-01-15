import { useChainType, useModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { AddImageModal } from "@/components/modals/AddImageModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { NoteTitleModal } from "@/components/modals/NoteTitleModal";
import { ContextProcessor } from "@/contextProcessor";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { COPILOT_TOOL_NAMES } from "@/LLMProviders/intentAnalyzer";
import { Mention } from "@/mentions/Mention";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { getToolDescription } from "@/tools/toolManager";
import { extractNoteTitles } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowBigUp, ChevronUp, Command, CornerDownLeft, Image, StopCircle } from "lucide-react";
import { App, Platform, TFile } from "obsidian";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ChatControls from "./ChatControls";
import { TooltipActionButton } from "./TooltipActionButton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: (metadata?: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
  }) => void;
  isGenerating: boolean;
  onStopGenerating: () => void;
  app: App;
  navigateHistory: (direction: "up" | "down") => string;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  mention: Mention;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  chatHistory: ChatMessage[];
}

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
      onNewChat,
      onSaveAsNote,
      onRefreshVaultContext,
      contextNotes,
      setContextNotes,
      includeActiveNote,
      setIncludeActiveNote,
      mention,
      selectedImages,
      onAddImage,
      setSelectedImages,
      chatHistory,
    },
    ref
  ) => {
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [tempInput, setTempInput] = useState("");
    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
    const [contextUrls, setContextUrls] = useState<string[]>([]);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentModelKey, setCurrentModelKey] = useModelKey();
    const [currentChain] = useChainType();
    const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(
      app.workspace.getActiveFile()
    );
    const [enableEnter, setEnableEnter] = useState(true);
    const settings = useSettingsValue();

    useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
    }));

    const onSendMessage = (includeVault: boolean) => {
      if (currentChain !== ChainType.COPILOT_PLUS_CHAIN) {
        handleSendMessage();
        return;
      }

      handleSendMessage({
        toolCalls: includeVault ? ["@vault"] : [],
        contextNotes,
        urls: contextUrls,
      });
    };

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
      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      const prompts = await customPromptProcessor.getAllPrompts();
      const promptTitles = prompts.map((prompt) => prompt.title);

      new ListPromptModal(app, promptTitles, async (promptTitle: string) => {
        const selectedPrompt = prompts.find((prompt) => prompt.title === promptTitle);
        if (selectedPrompt) {
          customPromptProcessor.recordPromptUsage(selectedPrompt.title);
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

      const cmdOrCtrl = Platform.isMacOS ? e.metaKey : e.ctrlKey;
      // Check for Cmd+Shift+Enter (Mac) or Ctrl+Shift+Enter (Windows)
      if (enableEnter && e.key === "Enter" && e.shiftKey && cmdOrCtrl) {
        e.preventDefault();
        e.stopPropagation();

        onSendMessage(true);
        setHistoryIndex(-1);
        setTempInput("");
        return;
      }

      if (enableEnter && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSendMessage(false);
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
          if (note.path === currentActiveNote?.path) {
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
    }, [inputMessage, includeActiveNote, currentActiveNote, mention, setContextNotes]);

    // Update the current active note whenever it changes
    useEffect(() => {
      let timeoutId: ReturnType<typeof setTimeout>;

      const handleActiveLeafChange = () => {
        // Clear any existing timeout
        clearTimeout(timeoutId);

        // Set new timeout
        timeoutId = setTimeout(() => {
          const activeNote = app.workspace.getActiveFile();
          setCurrentActiveNote(activeNote);
        }, 100); // Wait 100ms after the last event because it fires multiple times
      };

      const eventRef = app.workspace.on("active-leaf-change", handleActiveLeafChange);

      return () => {
        clearTimeout(timeoutId); // Clean up any pending timeout
        app.workspace.offref(eventRef); // unregister
      };
    }, [app.workspace]);

    return (
      <div
        className="flex flex-col w-full bg-primary p-1 gap-0.5 border border-solid border-border rounded-md shadow-sm focus-within:border-border-focus focus-within:shadow-md transition-[box-shadow,border-color] duration-100 ease-in-out"
        ref={containerRef}
        onClick={() => textAreaRef.current?.focus()}
      >
        <ChatControls
          onNewChat={onNewChat}
          onSaveAsNote={onSaveAsNote}
          onRefreshVaultContext={onRefreshVaultContext}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          activeNote={currentActiveNote}
          contextUrls={contextUrls}
          onRemoveUrl={(url: string) => setContextUrls((prev) => prev.filter((u) => u !== url))}
          chatHistory={chatHistory}
        />

        {selectedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 bg-secondary rounded mb-2">
            {selectedImages.map((file, index) => (
              <div key={index} className="relative w-20 h-20">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="w-full h-full object-cover rounded border border-solid border-border"
                />
                <button
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-modifier-error text-white border-none cursor-pointer flex items-center justify-center text-sm p-0 leading-none hover:bg-modifier-error-hover"
                  onClick={() => setSelectedImages((prev) => prev.filter((_, i) => i !== index))}
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          ref={textAreaRef}
          className="w-full max-h-[440px] resize-none overflow-y-auto px-3 py-0.5 rounded border-none shadow-none text-normal text-sm focus:outline-none focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus-visible:ring-offset-0 placeholder:text-muted placeholder:opacity-50"
          placeholder={
            "Ask anything. [[ for notes. / for custom prompts. " +
            (currentChain === ChainType.COPILOT_PLUS_CHAIN ? "@ for tools." : "")
          }
          value={inputMessage}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-controls">
          <div className="chat-input-left">
            <DropdownMenu.Root open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen}>
              <DropdownMenu.Trigger className="model-select-button">
                {settings.activeModels.find(
                  (model) => getModelKeyFromModel(model) === currentModelKey
                )?.name || "Select Model"}
                <ChevronUp size={10} />
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal container={activeDocument.body}>
                <DropdownMenu.Content className="model-select-content" align="start">
                  {settings.activeModels
                    .filter((model) => model.enabled)
                    .map((model) => (
                      <DropdownMenu.Item
                        key={getModelKeyFromModel(model)}
                        onSelect={() => setCurrentModelKey(getModelKeyFromModel(model))}
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
                  <div className="flex items-center">
                    <span className="text-[10px]">image</span>
                    <Image className="w-[18px] h-[18px]" />
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
            <button onClick={() => onSendMessage(false)} className="submit-button">
              <CornerDownLeft size={16} />
              <span>chat</span>
            </button>

            {currentChain === "copilot_plus" && (
              <button onClick={() => onSendMessage(true)} className="submit-button vault">
                <div className="flex items-center">
                  <>
                    {Platform.isMacOS ? (
                      <Command size={12} />
                    ) : (
                      <span className="text-[10px]">Ctrl</span>
                    )}
                    <ArrowBigUp size={16} />
                    <CornerDownLeft size={16} />
                  </>
                  <span className="text-[10px]">vault</span>
                </div>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Label className="flex items-center gap-1">
            <Checkbox
              className="border-border"
              checked={enableEnter}
              onCheckedChange={(checked: boolean) => setEnableEnter(checked)}
            />
            <span className="text-muted text-[10px]">Enter to Send</span>
          </Label>
        </div>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;
