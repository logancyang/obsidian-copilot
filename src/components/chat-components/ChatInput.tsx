import {
  ProjectConfig,
  getCurrentProject,
  subscribeToProjectChange,
  useChainType,
  useModelKey,
  useProjectLoading,
} from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { AddImageModal } from "@/components/modals/AddImageModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelDisplay } from "@/components/ui/model-display";
import { ContextProcessor } from "@/contextProcessor";
import { cn } from "@/lib/utils";
import { COPILOT_TOOL_NAMES } from "@/LLMProviders/intentAnalyzer";
import { Mention } from "@/mentions/Mention";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { SelectedTextContext } from "@/sharedState";
import { getToolDescription } from "@/tools/toolManager";
import {
  checkModelApiKey,
  err2String,
  extractNoteFiles,
  isAllowedFileForContext,
  isNoteTitleUnique,
} from "@/utils";
import {
  ChevronDown,
  CornerDownLeft,
  Database,
  Globe,
  Image,
  Loader2,
  StopCircle,
  X,
} from "lucide-react";
import { App, Notice, Platform, TFile } from "obsidian";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import ContextControl from "./ContextControl";

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
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  mention: Mention;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  disableModelSwitch?: boolean;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;
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
      contextNotes,
      setContextNotes,
      includeActiveNote,
      setIncludeActiveNote,
      mention,
      selectedImages,
      onAddImage,
      setSelectedImages,
      disableModelSwitch,
      selectedTextContexts,
      onRemoveSelectedText,
    },
    ref
  ) => {
    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
    const [contextUrls, setContextUrls] = useState<string[]>([]);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentModelKey, setCurrentModelKey] = useModelKey();
    const [modelError, setModelError] = useState<string | null>(null);
    const [currentChain] = useChainType();
    const [isProjectLoading] = useProjectLoading();
    const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(() => {
      const activeFile = app.workspace.getActiveFile();
      return isAllowedFileForContext(activeFile) ? activeFile : null;
    });
    const [selectedProject, setSelectedProject] = useState<ProjectConfig | null>(null);
    const settings = useSettingsValue();
    const isCopilotPlus =
      currentChain === ChainType.COPILOT_PLUS_CHAIN || currentChain === ChainType.PROJECT_CHAIN;

    // Toggle states for vault and web search
    const [vaultToggle, setVaultToggle] = useState(false);
    const [webToggle, setWebToggle] = useState(false);
    const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
    const loadingMessages = [
      "Loading the project context...",
      "Processing context files...",
      "If you have many files in context, this can take a while...",
    ];

    useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
    }));

    useEffect(() => {
      if (currentChain === ChainType.PROJECT_CHAIN) {
        setSelectedProject(getCurrentProject());

        const unsubscribe = subscribeToProjectChange((project) => {
          setSelectedProject(project);
        });

        return () => {
          unsubscribe();
        };
      } else {
        setSelectedProject(null);
      }
    }, [currentChain]);

    useEffect(() => {
      if (!isProjectLoading) return;

      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 3000);

      return () => clearInterval(interval);
    }, [isProjectLoading, loadingMessages.length]);

    const getDisplayModelKey = (): string => {
      if (
        selectedProject &&
        currentChain === ChainType.PROJECT_CHAIN &&
        selectedProject.projectModelKey
      ) {
        return selectedProject.projectModelKey;
      }
      return currentModelKey;
    };

    const onSendMessage = () => {
      if (!isCopilotPlus) {
        handleSendMessage();
        return;
      }

      // Build tool calls based on toggle states
      const toolCalls: string[] = [];
      if (vaultToggle) toolCalls.push("@vault");
      if (webToggle) toolCalls.push("@websearch");

      handleSendMessage({
        toolCalls,
        contextNotes,
        urls: contextUrls,
      });
    };

    const handleInputChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const inputValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      // Check for slash BEFORE updating state
      // Only show slash modal if:
      // 1. We just typed a "/" AND
      // 2. Either the input is empty OR there's a space before the "/"
      const shouldShowSlashModal =
        cursorPos > 0 &&
        inputValue[cursorPos - 1] === "/" &&
        (cursorPos === 1 || inputValue[cursorPos - 2] === " ");

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
      } else if (shouldShowSlashModal) {
        // Pass the inputValue directly to ensure we use the current value
        showCustomPromptModal(cursorPos, inputValue);
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

            // Check if this note title has duplicates
            const isUnique = isNoteTitleUnique(note.basename, app.vault);
            // If the title is unique, just show the title, otherwise show the full path
            const noteRef = isUnique ? note.basename : note.path;
            const newInputMessage = `${before}[[${noteRef}]]${after}`;
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
                const newCursorPos = cursorPos + noteRef.length + 2;
                textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
              }
            }, 0);
          },
          excludeNotePaths,
        }).open();
      };
      fetchNoteTitles();
    };

    const showCustomPromptModal = (cursorPos: number, currentInputValue: string) => {
      const commandManager = CustomCommandManager.getInstance();
      const commands = getCachedCustomCommands();
      const slashCommands = sortSlashCommands(
        commands.filter((command) => command.showInSlashMenu)
      );
      const commandTitles = slashCommands.map((command) => command.title);

      // Use the passed input value and cursor position
      const slashPosition = cursorPos - 1;

      const modal = new ListPromptModal(app, commandTitles, (commandTitle: string) => {
        const selectedCommand = slashCommands.find((command) => command.title === commandTitle);
        if (selectedCommand) {
          commandManager.recordUsage(selectedCommand);

          // Replace the "/" with the command content
          let before = "";
          let after = "";

          if (slashPosition >= 0 && currentInputValue[slashPosition] === "/") {
            before = currentInputValue.slice(0, slashPosition);
            after = currentInputValue.slice(slashPosition + 1);
          }

          const newInputMessage = before + selectedCommand.content + after;
          setInputMessage(newInputMessage);

          // Set cursor position after the inserted command content
          setTimeout(() => {
            if (textAreaRef.current) {
              const newCursorPos = before.length + selectedCommand.content.length;
              textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
              textAreaRef.current.focus();
            }
          }, 0);
        }
      });
      modal.open();
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

      if (e.key === "Enter") {
        /**
         * send msg:
         *         1. non-mobile platforms: only input Enter
         *         2. mobile platforms: Shift+Enter
         */
        const shouldSendMessage =
          (!e.shiftKey && !Platform.isMobile) || (e.shiftKey && Platform.isMobile);

        if (!shouldSendMessage) {
          // do nothing here, allowing the default newline behavior
          return;
        }

        e.preventDefault();
        onSendMessage();
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
      const currentFiles = new Set(extractNoteFiles(inputMessage, app.vault));
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
              // Keep it only if its file is still in the input
              return currentFiles.has(note);
            } else {
              // Case 2: Active note was NOT added by [[note]], but by the includeActiveNote toggle
              // Keep it only if includeActiveNote is true
              return includeActiveNote;
            }
          } else {
            // Handling for all other notes (not the active note)
            if (wasAddedViaReference) {
              // Case 3: Other note was added by typing [[note]]
              // Keep it only if its file is still in the input
              return currentFiles.has(note);
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
    }, [inputMessage, includeActiveNote, currentActiveNote, mention, setContextNotes, app.vault]);

    // Update the current active note whenever it changes
    useEffect(() => {
      let timeoutId: ReturnType<typeof setTimeout>;

      const handleActiveLeafChange = () => {
        // Clear any existing timeout
        clearTimeout(timeoutId);

        // Set new timeout
        timeoutId = setTimeout(() => {
          const activeNote = app.workspace.getActiveFile();
          setCurrentActiveNote(isAllowedFileForContext(activeNote) ? activeNote : null);
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
        className="tw-flex tw-w-full tw-flex-col tw-gap-0.5 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-1 tw-pb-1 tw-pt-2 tw-@container/chat-input"
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
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={onRemoveSelectedText}
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
                  <X className="tw-size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="tw-relative" {...(isCopilotPlus ? getRootProps() : {})}>
          {isProjectLoading && (
            <div className="tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-bg-primary tw-opacity-80 tw-backdrop-blur-sm">
              <div className="tw-flex tw-items-center tw-gap-2">
                <Loader2 className="tw-size-4 tw-animate-spin" />
                <span className="tw-text-sm">{loadingMessages[loadingMessageIndex]}</span>
              </div>
            </div>
          )}
          <textarea
            ref={textAreaRef}
            className="tw-max-h-40 tw-min-h-[60px] tw-w-full tw-resize-none tw-overflow-y-auto tw-rounded-md tw-border-none tw-bg-transparent tw-px-2 tw-text-sm tw-text-normal focus-visible:tw-ring-0"
            placeholder={
              "Ask anything. [[ for notes. / for custom prompts. " +
              (isCopilotPlus ? "@ for tools." : "")
            }
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isProjectLoading}
          />
          {isCopilotPlus && (
            <>
              <input {...getInputProps()} />
              {/* Overlay that appears when dragging */}
              {isDragActive && (
                <div className="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary">
                  <span>Drop images here...</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="tw-flex tw-h-6 tw-justify-between tw-gap-1 tw-px-1">
          {isGenerating ? (
            <div className="tw-flex tw-items-center tw-gap-1 tw-px-1 tw-text-sm tw-text-faint">
              <Loader2 className="tw-size-3 tw-animate-spin" />
              <span>Generating...</span>
            </div>
          ) : (
            <DropdownMenu open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost2" size="fit" disabled={disableModelSwitch}>
                  {modelError ? (
                    <span className="tw-text-error">Model Load Failed</span>
                  ) : settings.activeModels.find(
                      (model) =>
                        model.enabled && getModelKeyFromModel(model) === getDisplayModelKey()
                    ) ? (
                    <ModelDisplay
                      model={
                        settings.activeModels.find(
                          (model) =>
                            model.enabled && getModelKeyFromModel(model) === getDisplayModelKey()
                        )!
                      }
                      iconSize={8}
                    />
                  ) : (
                    "Select Model"
                  )}
                  {!disableModelSwitch && <ChevronDown className="tw-mt-0.5 tw-size-5" />}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start">
                {!disableModelSwitch &&
                  settings.activeModels
                    .filter((model) => model.enabled)
                    .map((model) => {
                      const { hasApiKey, errorNotice } = checkModelApiKey(model, settings);
                      return (
                        <DropdownMenuItem
                          key={getModelKeyFromModel(model)}
                          onSelect={async (event) => {
                            if (!hasApiKey && errorNotice) {
                              event.preventDefault();
                              new Notice(errorNotice);
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
                                (m) => m.enabled && getModelKeyFromModel(m) === currentModelKey
                              );
                              if (lastValidModel) {
                                setCurrentModelKey(getModelKeyFromModel(lastValidModel));
                              }
                            }
                          }}
                          className={!hasApiKey ? "tw-cursor-not-allowed tw-opacity-50" : ""}
                        >
                          <ModelDisplay model={model} iconSize={12} />
                        </DropdownMenuItem>
                      );
                    })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="tw-flex tw-items-center tw-gap-1">
            {isGenerating ? (
              <Button
                variant="ghost2"
                size="fit"
                className="tw-text-muted"
                onClick={() => onStopGenerating()}
              >
                <StopCircle className="tw-size-4" />
                Stop
              </Button>
            ) : (
              <>
                {/* Toggle buttons for vault and web search - only show when Autonomous Agent is off */}
                {!settings.enableAutonomousAgent && (
                  <>
                    <Button
                      variant="ghost2"
                      size="fit"
                      onClick={() => setVaultToggle(!vaultToggle)}
                      className={cn(
                        "tw-mr-2 tw-text-muted hover:tw-text-accent",
                        vaultToggle && "tw-text-accent tw-bg-accent/10"
                      )}
                      title="Toggle vault search"
                    >
                      <Database className="tw-size-4" />
                    </Button>
                    <Button
                      variant="ghost2"
                      size="fit"
                      onClick={() => setWebToggle(!webToggle)}
                      className={cn(
                        "tw-mr-2 tw-text-muted hover:tw-text-accent",
                        webToggle && "tw-text-accent tw-bg-accent/10"
                      )}
                      title="Toggle web search"
                    >
                      <Globe className="tw-size-4" />
                    </Button>
                  </>
                )}

                {isCopilotPlus && (
                  <Button
                    variant="ghost2"
                    size="fit"
                    className="tw-text-muted hover:tw-text-accent"
                    onClick={() => {
                      new AddImageModal(app, onAddImage).open();
                    }}
                    title="Add image(s)"
                  >
                    <Image className="tw-size-4" />
                  </Button>
                )}
                <Button
                  variant="ghost2"
                  size="fit"
                  className="tw-text-muted"
                  onClick={() => onSendMessage()}
                >
                  <CornerDownLeft className="!tw-size-3" />
                  <span>chat</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;
