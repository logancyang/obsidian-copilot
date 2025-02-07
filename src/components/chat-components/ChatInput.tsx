import { useChainType, useModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { AddImageModal } from "@/components/modals/AddImageModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { ContextProcessor } from "@/contextProcessor";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { COPILOT_TOOL_NAMES } from "@/LLMProviders/intentAnalyzer";
import { Mention } from "@/mentions/Mention";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { getToolDescription } from "@/tools/toolManager";
import { err2String, extractNoteTitles } from "@/utils";
import { DisplayKeyProviders, ProviderSettingsKeyMap } from "@/constants";
import {
  ArrowBigUp,
  ChevronDown,
  Command,
  CornerDownLeft,
  Image,
  StopCircle,
  X,
} from "lucide-react";
import { App, Platform, TFile } from "obsidian";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import ContextControl from "./ContextControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { Notice } from "obsidian";

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
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  mention: Mention;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
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
      contextNotes,
      setContextNotes,
      includeActiveNote,
      setIncludeActiveNote,
      mention,
      selectedImages,
      onAddImage,
      setSelectedImages,
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
    const [modelError, setModelError] = useState<string | null>(null);
    const [currentChain] = useChainType();
    const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(
      app.workspace.getActiveFile()
    );
    const settings = useSettingsValue();
    const isCopilotPlus = currentChain === ChainType.COPILOT_PLUS_CHAIN;

    useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
    }));

    const onSendMessage = (includeVault: boolean) => {
      if (!isCopilotPlus) {
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
      } else if (inputValue.slice(-1) === "@" && isCopilotPlus) {
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
        const contextProcessor = ContextProcessor.getInstance();

        new AddContextNoteModal({
          app,
          onNoteSelect: async (note: TFile) => {
            const before = inputMessage.slice(0, cursorPos - 2);
            const after = inputMessage.slice(cursorPos - 1);
            const newInputMessage = `${before}[[${note.basename}]]${after}`;
            setInputMessage(newInputMessage);

            const activeNote = app.workspace.getActiveFile();
            if (note) {
              await contextProcessor.addNoteToContext(
                note,
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
                const newCursorPos = cursorPos + note.basename.length + 2;
                textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
              }
            }, 0);
          },
          excludeNotePaths,
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

      // Check for Cmd+Shift+Enter (Mac) or Ctrl+Shift+Enter (Windows)
      if (e.key === "Enter" && e.shiftKey && (Platform.isMacOS ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();

        onSendMessage(true);
        setHistoryIndex(-1);
        setTempInput("");
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
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

    const handlePaste = useCallback(
      async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items || !isCopilotPlus) return;

        const imageItems = Array.from(items).filter((item) => item.type.indexOf("image") !== -1);

        if (imageItems.length > 0) {
          e.preventDefault();

          const files = await Promise.all(
            imageItems.map((item) => {
              const file = item.getAsFile();
              if (!file) return null;
              return file;
            })
          );

          const validFiles = files.filter((file) => file !== null);
          if (validFiles.length > 0) {
            onAddImage(validFiles);
          }
        }
      },
      [onAddImage, isCopilotPlus]
    );

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

    // Add dropzone configuration
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
      accept: {
        "image/*": [".png", ".gif", ".jpeg", ".jpg", ".webp"],
      },
      onDrop: (acceptedFiles) => {
        onAddImage(acceptedFiles);
      },
      noClick: true, // Prevents clicking on textarea from opening file dialog
      noDragEventsBubbling: true,
    });

    const excludeNotePaths = useMemo(
      () =>
        [
          ...contextNotes.map((note) => note.path),
          ...(includeActiveNote && currentActiveNote ? [currentActiveNote.path] : []),
        ].filter((note) => note != null),
      [contextNotes, includeActiveNote, currentActiveNote]
    );

    return (
      <div
        className="flex flex-col gap-0.5 w-full border border-border border-solid rounded-md pt-2 pb-1 px-1"
        ref={containerRef}
      >
        <ContextControl
          app={app}
          excludeNotePaths={excludeNotePaths}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          activeNote={currentActiveNote}
          contextUrls={contextUrls}
          onRemoveUrl={(url: string) => setContextUrls((prev) => prev.filter((u) => u !== url))}
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
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative" {...(isCopilotPlus ? getRootProps() : {})}>
          <textarea
            ref={textAreaRef}
            className="w-full bg-transparent focus-visible:ring-0 border-none min-h-[60px] max-h-40 overflow-y-auto resize-none px-2 rounded-md text-sm text-normal"
            placeholder={
              "Ask anything. [[ for notes. / for custom prompts. " +
              (isCopilotPlus ? "@ for tools." : "")
            }
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          {isCopilotPlus && (
            <>
              <input {...getInputProps()} />
              {/* Overlay that appears when dragging */}
              {isDragActive && (
                <div className="absolute inset-0 bg-primary border border-dashed border-primary rounded-md flex items-center justify-center">
                  <span className="text-primary">Drop images here...</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-1 justify-between px-1">
          <div className="flex items-center gap-1">
            <DropdownMenu open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost2" size="fit">
                  {modelError ? (
                    <span className="text-error">Model Load Failed</span>
                  ) : (
                    settings.activeModels.find(
                      (model) => model.enabled && getModelKeyFromModel(model) === currentModelKey
                    )?.name || "Select Model"
                  )}
                  <ChevronDown className="size-5 mt-0.5" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start">
                {settings.activeModels
                  .filter((model) => model.enabled)
                  .map((model) => {
                    const providerKeyName =
                      ProviderSettingsKeyMap[model.provider as DisplayKeyProviders];
                    const hasNoApiKey = !model.apiKey && !settings[providerKeyName];
                    return (
                      <DropdownMenuItem
                        key={getModelKeyFromModel(model)}
                        onSelect={async (event) => {
                          if (hasNoApiKey) {
                            event.preventDefault();
                            const notice =
                              `Please configure API Key for ${model.name} in settings first.` +
                              "\nPath: Settings > copilot plugin > Basic Tab > Set Keys";
                            new Notice(notice);
                            return;
                          }

                          try {
                            setModelError(null);
                            setCurrentModelKey(getModelKeyFromModel(model));
                          } catch (error) {
                            const msg = `Model switch failed: ` + err2String(error);
                            setModelError(msg);
                            new Notice(msg);
                            // Restore to the last valid model
                            const lastValidModel = settings.activeModels.find(
                              (m) => getModelKeyFromModel(m) === currentModelKey
                            );
                            if (lastValidModel) {
                              setCurrentModelKey(getModelKeyFromModel(lastValidModel));
                            }
                          }
                        }}
                        className={hasNoApiKey ? "opacity-50 cursor-not-allowed" : ""}
                      >
                        {model.name}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>

            {isCopilotPlus && (
              <Button
                variant="ghost2"
                size="fit"
                onClick={() => {
                  new AddImageModal(app, onAddImage).open();
                }}
              >
                <div className="flex items-center gap-1">
                  <span>image</span>
                  <Image className="!size-3" />
                </div>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            {isGenerating && (
              <Button
                variant="ghost2"
                size="fit"
                className="text-muted"
                onClick={() => onStopGenerating()}
              >
                <StopCircle className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost2"
              size="fit"
              className="text-muted"
              onClick={() => onSendMessage(false)}
            >
              <CornerDownLeft className="!size-3" />
              <span>chat</span>
            </Button>

            {currentChain === "copilot_plus" && (
              <Button
                variant="ghost2"
                size="fit"
                className="text-muted"
                onClick={() => onSendMessage(true)}
              >
                <div className="flex items-center gap-1">
                  {Platform.isMacOS ? (
                    <div className="flex items-center">
                      <Command className="!size-3" />
                      <ArrowBigUp className="!size-3" />
                      <CornerDownLeft className="!size-3" />
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <span>Ctrl</span>
                      <ArrowBigUp className="size-4" />
                      <CornerDownLeft className="!size-3" />
                    </div>
                  )}
                  <span>vault</span>
                </div>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;
