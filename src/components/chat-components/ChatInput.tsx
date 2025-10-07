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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { $getSelection, $isRangeSelection } from "lexical";
import { ContextControl } from "./ContextControl";
import { $removePillsByPath } from "./pills/NotePillNode";
import { $removeActiveNotePills } from "./pills/ActiveNotePillNode";
import { $removePillsByURL } from "./pills/URLPillNode";
import { $removePillsByFolder } from "./pills/FolderPillNode";
import { $removePillsByToolName, $createToolPillNode } from "./pills/ToolPillNode";
import LexicalEditor from "./LexicalEditor";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: (metadata?: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
    contextFolders?: string[];
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

  // Edit mode props
  editMode?: boolean;
  onEditSave?: (
    text: string,
    context: {
      notes: TFile[];
      urls: string[];
      folders: string[];
    }
  ) => void;
  onEditCancel?: () => void;
  initialContext?: {
    notes?: TFile[];
    urls?: string[];
    folders?: string[];
  };
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
  editMode = false,
  onEditSave,
  onEditCancel,
  initialContext,
}) => {
  const [contextUrls, setContextUrls] = useState<string[]>(initialContext?.urls || []);
  const [contextFolders, setContextFolders] = useState<string[]>(initialContext?.folders || []);
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
  const [foldersFromPills, setFoldersFromPills] = useState<string[]>([]);
  const [toolsFromPills, setToolsFromPills] = useState<string[]>([]);
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
    // Handle edit mode
    if (editMode && onEditSave) {
      onEditSave(inputMessage, {
        notes: contextNotes,
        urls: contextUrls,
        folders: contextFolders,
      });
      return;
    }

    if (!isCopilotPlus) {
      handleSendMessage();
      return;
    }

    // Build tool calls based on toggle states
    const toolCalls: string[] = [];
    // Only add tool calls when autonomous agent is off
    // When autonomous agent is on, it handles all tools internally
    if (!autonomousAgentToggle) {
      const messageLower = inputMessage.toLowerCase();

      // Only add tools from buttons if they're not already in the message
      if (vaultToggle && !messageLower.includes("@vault")) {
        toolCalls.push("@vault");
      }
      if (webToggle && !messageLower.includes("@websearch") && !messageLower.includes("@web")) {
        toolCalls.push("@websearch");
      }
      if (composerToggle && !messageLower.includes("@composer")) {
        toolCalls.push("@composer");
      }
    }

    handleSendMessage({
      toolCalls,
      contextNotes,
      urls: contextUrls,
      contextFolders,
    });
  };

  // Handle when pills are removed from the editor
  const handleNotePillsRemoved = (removedNotes: { path: string; basename: string }[]) => {
    const removedPaths = new Set(removedNotes.map((note) => note.path));

    setContextNotes((prev) => {
      return prev.filter((contextNote) => {
        // Remove any note whose pill was removed
        return !removedPaths.has(contextNote.path);
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

  // Handle when tools are removed from pills (when pills are deleted in editor)
  const handleToolPillsRemoved = (removedTools: string[]) => {
    if (!isCopilotPlus || autonomousAgentToggle) return;

    // Update tool button states based on removed pills
    removedTools.forEach((tool) => {
      switch (tool) {
        case "@vault":
          setVaultToggle(false);
          break;
        case "@websearch":
        case "@web":
          setWebToggle(false);
          break;
        case "@composer":
          setComposerToggle(false);
          break;
      }
    });
  };

  // Sync tool button states with tool pills
  useEffect(() => {
    if (!isCopilotPlus || autonomousAgentToggle) return;

    // Update button states based on current tool pills
    const hasVault = toolsFromPills.includes("@vault");
    const hasWeb = toolsFromPills.includes("@websearch") || toolsFromPills.includes("@web");
    const hasComposer = toolsFromPills.includes("@composer");

    setVaultToggle(hasVault);
    setWebToggle(hasWeb);
    setComposerToggle(hasComposer);
  }, [toolsFromPills, isCopilotPlus, autonomousAgentToggle]);

  // Handle when context notes are removed from the context menu
  // This should remove all corresponding pills from the editor
  const handleContextNoteRemoved = (notePath: string) => {
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

  // Handle when context folders are removed from the context menu
  // This should remove all corresponding folder pills from the editor
  const handleFolderContextRemoved = (folderPath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByFolder(folderPath);
      });
    }

    // Also immediately update foldersFromPills to prevent stale data from re-adding the folder
    setFoldersFromPills((prev) => prev.filter((pillFolder) => pillFolder !== folderPath));
  };

  // Unified handler for adding to context (from popover @ mention)
  const handleAddToContext = (category: string, data: any) => {
    switch (category) {
      case "activeNote":
        // Set active note context flag (no pill needed - context badge shows it)
        setIncludeActiveNote(true);
        break;
      case "notes":
        if (data instanceof TFile) {
          const activeNote = app.workspace.getActiveFile();
          if (activeNote && data.path === activeNote.path) {
            setIncludeActiveNote(true);
            setContextNotes((prev) => prev.filter((n) => n.path !== data.path));
          } else {
            setContextNotes((prev) => {
              const existingNote = prev.find((n) => n.path === data.path);
              if (existingNote) {
                return prev; // Note already exists, no change needed
              } else {
                return [...prev, data];
              }
            });
          }
        }
        break;
      case "tools":
        // Add tool pill to lexical editor when selected from @ mention typeahead
        if (typeof data === "string" && lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            // Insert tool pill at current cursor position
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              const toolPill = $createToolPillNode(data);
              selection.insertNodes([toolPill]);
            }
          });
          // Note: toolsFromPills will be updated automatically via ToolPillSyncPlugin
        }
        break;
      case "folders":
        // For folders from context menu, update contextFolders directly (no pills in editor)
        if (data && data.path) {
          const folderPath = data.path;
          setContextFolders((prev) => {
            const exists = prev.find((f) => f === folderPath);
            if (!exists) {
              return [...prev, folderPath];
            }
            return prev;
          });
        }
        break;
    }
  };

  // Unified handler for removing from context (from context menu badges)
  const handleRemoveFromContext = (category: string, data: any) => {
    switch (category) {
      case "activeNote":
        // Remove active note pill from editor and turn off flag
        setIncludeActiveNote(false);
        if (lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            $removeActiveNotePills();
          });
        }
        break;
      case "notes":
        if (typeof data === "string") {
          // data is the path
          // Check if this is the active note
          if (currentActiveNote?.path === data && includeActiveNote) {
            setIncludeActiveNote(false);
          } else {
            // Remove from contextNotes
            setContextNotes((prev) => prev.filter((note) => note.path !== data));
          }
          // Also remove corresponding pills from editor
          handleContextNoteRemoved(data);
        }
        break;
      case "urls":
        if (typeof data === "string") {
          setContextUrls((prev) => prev.filter((u) => u !== data));
          handleURLContextRemoved(data);
        }
        break;
      case "folders":
        if (typeof data === "string") {
          // data is the path
          setContextFolders((prev) => prev.filter((f) => f !== data));
          handleFolderContextRemoved(data);
        }
        break;
      case "selectedText":
        if (typeof data === "string") {
          // data is the id
          onRemoveSelectedText?.(data);
        }
        break;
    }
  };

  // Handle when folders are removed from pills (when pills are deleted in editor)
  const handleFolderPillsRemoved = (removedFolders: string[]) => {
    const removedFolderPaths = new Set(removedFolders);

    setContextFolders((prev) => {
      return prev.filter((folder) => {
        if (removedFolderPaths.has(folder)) {
          return false; // Remove this folder
        }
        return true; // Keep this folder
      });
    });
  };

  // Pill-to-context synchronization (when pills are added)
  useEffect(() => {
    setContextNotes((prev) => {
      const contextPaths = new Set(prev.map((note) => note.path));

      // Find notes that need to be added
      const newNotesFromPills = notesFromPills.filter((pillNote) => {
        // Only add if not already in context
        return !contextPaths.has(pillNote.path);
      });

      // Add completely new notes from pills
      const newFiles: TFile[] = [];
      newNotesFromPills.forEach((pillNote) => {
        const file = app.vault.getAbstractFileByPath(pillNote.path);
        if (file instanceof TFile) {
          newFiles.push(file);
        }
      });

      return [...prev, ...newFiles];
    });
  }, [notesFromPills, app.vault, setContextNotes]);

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

  // Folder-to-context synchronization (when folders are added via pills)
  useEffect(() => {
    setContextFolders((prev) => {
      const contextFolderPaths = new Set(prev);

      // Find folders that need to be added
      const newFoldersFromPills = foldersFromPills.filter((pillFolder) => {
        // Only add if not already in context
        return !contextFolderPaths.has(pillFolder);
      });

      // Add completely new folders from pills
      return [...prev, ...newFoldersFromPills];
    });
  }, [foldersFromPills]);

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

  const onEditorReady = useCallback((editor: any) => {
    lexicalEditorRef.current = editor;
  }, []);

  // Handle Escape key for edit mode
  useEffect(() => {
    if (!editMode || !onEditCancel) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEditCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editMode, onEditCancel]);

  // Handle tool button toggle-off events - remove corresponding pills
  const handleVaultToggleOff = useCallback(() => {
    if (lexicalEditorRef.current && isCopilotPlus) {
      lexicalEditorRef.current.update(() => {
        $removePillsByToolName("@vault");
      });
    }
  }, [isCopilotPlus]);

  const handleWebToggleOff = useCallback(() => {
    if (lexicalEditorRef.current && isCopilotPlus) {
      lexicalEditorRef.current.update(() => {
        $removePillsByToolName("@websearch");
        $removePillsByToolName("@web");
      });
    }
  }, [isCopilotPlus]);

  const handleComposerToggleOff = useCallback(() => {
    if (lexicalEditorRef.current && isCopilotPlus) {
      lexicalEditorRef.current.update(() => {
        $removePillsByToolName("@composer");
      });
    }
  }, [isCopilotPlus]);

  // Active note pill sync callbacks
  const handleActiveNoteAdded = useCallback(() => {
    setIncludeActiveNote(true);
  }, [setIncludeActiveNote]);

  const handleActiveNoteRemoved = useCallback(() => {
    setIncludeActiveNote(false);
  }, [setIncludeActiveNote]);

  return (
    <div
      className="tw-flex tw-w-full tw-flex-col tw-gap-0.5 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-1 tw-pb-1 tw-pt-2 tw-@container/chat-input"
      ref={containerRef}
    >
      <ContextControl
        contextNotes={contextNotes}
        includeActiveNote={includeActiveNote}
        activeNote={currentActiveNote}
        contextUrls={contextUrls}
        contextFolders={contextFolders}
        selectedTextContexts={selectedTextContexts}
        showProgressCard={showProgressCard}
        lexicalEditorRef={lexicalEditorRef}
        onAddToContext={handleAddToContext}
        onRemoveFromContext={handleRemoveFromContext}
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
          onNotesRemoved={handleNotePillsRemoved}
          onActiveNoteAdded={handleActiveNoteAdded}
          onActiveNoteRemoved={handleActiveNoteRemoved}
          onURLsChange={isCopilotPlus ? setUrlsFromPills : undefined}
          onURLsRemoved={isCopilotPlus ? handleURLPillsRemoved : undefined}
          onToolsChange={isCopilotPlus ? setToolsFromPills : undefined}
          onToolsRemoved={isCopilotPlus ? handleToolPillsRemoved : undefined}
          onFoldersChange={setFoldersFromPills}
          onFoldersRemoved={handleFolderPillsRemoved}
          onEditorReady={onEditorReady}
          onImagePaste={onAddImage}
          placeholder={"Your AI assistant for Obsidian • @ to add context • / for custom prompts"}
          disabled={isProjectLoading}
          isCopilotPlus={isCopilotPlus}
          currentActiveFile={currentActiveNote}
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
                onVaultToggleOff={handleVaultToggleOff}
                onWebToggleOff={handleWebToggleOff}
                onComposerToggleOff={handleComposerToggleOff}
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
              {editMode && onEditCancel && (
                <Button
                  variant="ghost2"
                  size="fit"
                  className="tw-text-muted"
                  onClick={onEditCancel}
                >
                  <span>cancel</span>
                </Button>
              )}
              <Button
                variant="ghost2"
                size="fit"
                className="tw-text-muted"
                onClick={() => onSendMessage()}
              >
                <CornerDownLeft className="!tw-size-3" />
                <span>{editMode ? "save" : "chat"}</span>
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
