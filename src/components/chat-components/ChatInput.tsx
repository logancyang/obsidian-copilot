import {
  getCurrentProject,
  ProjectConfig,
  subscribeToProjectChange,
  useChainType,
  useModelKey,
  useProjectLoading,
} from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { AddImageModal } from "@/components/modals/AddImageModal";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatToolControls } from "./ChatToolControls";
import { isPlusChain } from "@/utils";

import { useSettingsValue } from "@/settings/model";
import { SelectedTextContext } from "@/types/message";
import { isAllowedFileForContext } from "@/utils";
import { CornerDownLeft, Image, Loader2, StopCircle, X } from "lucide-react";
import { App, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import ContextControl from "./ContextControl";
import { $removePillsByPath } from "./NotePillPlugin";
import { $removePillsByURL } from "./URLPillNode";
import LexicalEditor from "./LexicalEditor";

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
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  disableModelSwitch?: boolean;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;
  showProgressCard: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
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
  selectedImages,
  onAddImage,
  setSelectedImages,
  disableModelSwitch,
  selectedTextContexts,
  onRemoveSelectedText,
  showProgressCard,
}) => {
  const [contextUrls, setContextUrls] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<any>(null);
  const [currentModelKey, setCurrentModelKey] = useModelKey();
  const [currentChain] = useChainType();
  const [isProjectLoading] = useProjectLoading();
  const settings = useSettingsValue();
  const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(() => {
    const activeFile = app.workspace.getActiveFile();
    return isAllowedFileForContext(activeFile) ? activeFile : null;
  });
  const [selectedProject, setSelectedProject] = useState<ProjectConfig | null>(null);
  const [notesFromPills, setNotesFromPills] = useState<{ path: string; basename: string }[]>([]);
  const [urlsFromPills, setUrlsFromPills] = useState<string[]>([]);
  const isCopilotPlus = isPlusChain(currentChain);

  // Toggle states for vault, web search, composer, and autonomous agent
  const [vaultToggle, setVaultToggle] = useState(false);
  const [webToggle, setWebToggle] = useState(false);
  const [composerToggle, setComposerToggle] = useState(false);
  const [autonomousAgentToggle, setAutonomousAgentToggle] = useState(
    settings.enableAutonomousAgent
  );
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const loadingMessages = [
    "Loading the project context...",
    "Processing context files...",
    "If you have many files in context, this can take a while...",
  ];

  // Sync autonomous agent toggle with settings and chain type
  useEffect(() => {
    if (currentChain === ChainType.PROJECT_CHAIN) {
      // Force off in Projects mode
      setAutonomousAgentToggle(false);
    } else {
      // In other modes, use the actual settings value
      setAutonomousAgentToggle(settings.enableAutonomousAgent);
    }
  }, [settings.enableAutonomousAgent, currentChain]);

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
    // Only add tool calls when autonomous agent is off
    // When autonomous agent is on, it handles all tools internally
    if (!autonomousAgentToggle) {
      if (vaultToggle) toolCalls.push("@vault");
      if (webToggle) toolCalls.push("@web-search");
      if (composerToggle) toolCalls.push("@composer");
    }

    handleSendMessage({
      toolCalls,
      contextNotes,
      urls: contextUrls,
    });
  };

  // TODO: Re-implement these features for Lexical editor:
  // - Slash commands (/)
  // - Note references ([[]])
  // - Tool mentions (@)
  // - URL extraction and context updates

  /* LEGACY TEXTAREA HANDLERS - TO BE ADAPTED FOR LEXICAL
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
      if (newUrls.length > 0 && isPlusChain(currentChain)) {
        // Only add URLs to context for Plus chains
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;

      if (e.key === "Enter") {
        // send msg:
        // 1. non-mobile platforms: only input Enter
        // 2. mobile platforms: Shift+Enter
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
        if (!items) return;

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
      [onAddImage]
    );
    */

  /* LEGACY HELPER FUNCTIONS - TO BE ADAPTED FOR LEXICAL
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
    */

  // Handle when pills are removed from the editor
  const handlePillsRemoved = (removedNotes: { path: string; basename: string }[]) => {
    const removedPaths = new Set(removedNotes.map((note) => note.path));

    setContextNotes((prev) => {
      return prev
        .filter((contextNote) => {
          // Only remove if the note was removed via pill AND was not added manually
          if (removedPaths.has(contextNote.path)) {
            const wasAddedManually = (contextNote as any).wasAddedManually;
            // If it was added manually, keep it in context
            // If it was only added via reference, remove it
            return wasAddedManually;
          }
          return true;
        })
        .map((contextNote) => {
          // If the note is being kept but pills were removed, remove the wasAddedViaReference flag
          if (removedPaths.has(contextNote.path)) {
            const updatedNote = { ...contextNote };
            delete (updatedNote as any).wasAddedViaReference;
            return updatedNote;
          }
          return contextNote;
        });
    });
  };

  // Handle when URLs are removed from pills (when pills are deleted in editor)
  const handleURLPillsRemoved = (removedUrls: string[]) => {
    const removedUrlSet = new Set(removedUrls);

    setContextUrls((prev) => {
      return prev.filter((url) => {
        if (removedUrlSet.has(url)) {
          return false;
        }
        return true;
      });
    });
  };

  // Handle when context notes are removed from the context menu
  // This should remove all corresponding pills from the editor
  const handleContextRemoved = (notePath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByPath(notePath);
      });
    }

    // Also immediately update notesFromPills to prevent stale data from re-adding the note
    setNotesFromPills((prev) => prev.filter((note) => note.path !== notePath));
  };

  // Handle when context URLs are removed from the context menu
  // This should remove all corresponding URL pills from the editor
  const handleURLContextRemoved = (url: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByURL(url);
      });
    }

    // Also immediately update urlsFromPills to prevent stale data from re-adding the URL
    setUrlsFromPills((prev) => prev.filter((pillUrl) => pillUrl !== url));
  };

  // Pill-to-context synchronization (when pills are added)
  useEffect(() => {
    setContextNotes((prev) => {
      const contextPaths = new Set(prev.map((note) => note.path));
      const pillPaths = new Set(notesFromPills.map((note) => note.path));

      // Find notes that need to be added
      const newNotesFromPills = notesFromPills.filter((pillNote) => {
        // Don't add if it's the active note and includeActiveNote is already true
        if (currentActiveNote?.path === pillNote.path && includeActiveNote) return false;
        // Only add if not already in context
        return !contextPaths.has(pillNote.path);
      });

      // Update existing notes to mark them as having pills
      const updated = prev.map((contextNote) => {
        // If this note is now represented by pills, mark it as added via reference too
        if (pillPaths.has(contextNote.path)) {
          // Preserve existing flags, only add wasAddedViaReference
          const updatedNote = { ...contextNote };
          (updatedNote as any).wasAddedViaReference = true;
          // Preserve wasAddedManually if it exists
          if ((contextNote as any).wasAddedManually) {
            (updatedNote as any).wasAddedManually = true;
          }
          return updatedNote;
        }
        return contextNote;
      });

      // Add completely new notes from pills
      const newFiles: TFile[] = [];
      newNotesFromPills.forEach((pillNote) => {
        const file = app.vault.getAbstractFileByPath(pillNote.path);
        if (file instanceof TFile) {
          newFiles.push(Object.assign(file, { wasAddedViaReference: true }));
        }
      });

      return [...updated, ...newFiles];
    });
  }, [notesFromPills, currentActiveNote, includeActiveNote, app.vault, setContextNotes]);

  // URL pill-to-context synchronization (when URL pills are added) - only for Plus chains
  useEffect(() => {
    if (isPlusChain(currentChain)) {
      setContextUrls((prev) => {
        const contextUrlSet = new Set(prev);

        // Find URLs that need to be added
        const newUrlsFromPills = urlsFromPills.filter((pillUrl) => {
          // Only add if not already in context
          return !contextUrlSet.has(pillUrl);
        });

        // Add completely new URLs from pills
        if (newUrlsFromPills.length > 0) {
          return Array.from(new Set([...prev, ...newUrlsFromPills]));
        }

        return prev;
      });
    } else {
      // Clear URLs for non-Plus chains
      setContextUrls([]);
    }
  }, [urlsFromPills, currentChain]);

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
      // cspell:disable-next-line
      app.workspace.offref(eventRef); // Remove event listener
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

  const onEditorReady = useCallback((editor: any) => {
    lexicalEditorRef.current = editor;
  }, []);

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
        onRemoveUrl={(url: string) => {
          setContextUrls((prev) => prev.filter((u) => u !== url));
          handleURLContextRemoved(url);
        }}
        selectedTextContexts={selectedTextContexts}
        onRemoveSelectedText={onRemoveSelectedText}
        showProgressCard={showProgressCard}
        onContextRemoved={handleContextRemoved}
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

      <div className="tw-relative" {...getRootProps()}>
        {isProjectLoading && (
          <div className="tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-bg-primary tw-opacity-80 tw-backdrop-blur-sm">
            <div className="tw-flex tw-items-center tw-gap-2">
              <Loader2 className="tw-size-4 tw-animate-spin" />
              <span className="tw-text-sm">{loadingMessages[loadingMessageIndex]}</span>
            </div>
          </div>
        )}
        <LexicalEditor
          value={inputMessage}
          onChange={(value) => setInputMessage(value)}
          onSubmit={onSendMessage}
          onNotesChange={setNotesFromPills}
          onNotesRemoved={handlePillsRemoved}
          onURLsChange={isCopilotPlus ? setUrlsFromPills : undefined}
          onURLsRemoved={isCopilotPlus ? handleURLPillsRemoved : undefined}
          onEditorReady={onEditorReady}
          placeholder={
            "Ask anything. [[ for notes. / for custom prompts. " +
            (isCopilotPlus ? "@ for tools." : "")
          }
          disabled={isProjectLoading}
        />
        <input {...getInputProps()} />
        {/* Overlay that appears when dragging */}
        {isDragActive && (
          <div className="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary">
            <span>Drop images here...</span>
          </div>
        )}
      </div>

      <div className="tw-flex tw-h-6 tw-justify-between tw-gap-1 tw-px-1">
        {isGenerating ? (
          <div className="tw-flex tw-items-center tw-gap-1 tw-px-1 tw-text-sm tw-text-muted">
            <Loader2 className="tw-size-3 tw-animate-spin" />
            <span>Generating...</span>
          </div>
        ) : (
          <div className="tw-min-w-0 tw-flex-1">
            <ModelSelector
              variant="ghost2"
              size="fit"
              disabled={disableModelSwitch}
              value={getDisplayModelKey()}
              onChange={(modelKey) => {
                // In project mode, we don't update the global model key
                // as the project model takes precedence
                if (currentChain !== ChainType.PROJECT_CHAIN) {
                  setCurrentModelKey(modelKey);
                }
              }}
              className="tw-max-w-full tw-truncate"
            />
          </div>
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
              <ChatToolControls
                vaultToggle={vaultToggle}
                setVaultToggle={setVaultToggle}
                webToggle={webToggle}
                setWebToggle={setWebToggle}
                composerToggle={composerToggle}
                setComposerToggle={setComposerToggle}
                autonomousAgentToggle={autonomousAgentToggle}
                setAutonomousAgentToggle={setAutonomousAgentToggle}
                currentChain={currentChain}
              />
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost2"
                      size="fit"
                      className="tw-text-muted hover:tw-text-accent"
                      onClick={() => {
                        new AddImageModal(app, onAddImage).open();
                      }}
                    >
                      <Image className="tw-size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="tw-px-1 tw-py-0.5">Add image(s)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
};

ChatInput.displayName = "ChatInput";

export default ChatInput;
