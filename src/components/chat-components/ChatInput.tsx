import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { useChainType, useModelKey } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useSettingsValue } from "@/settings/model";
import type { CopilotMode } from "@/agentMode";
import { isPlusChain } from "@/utils";
import {
  mergeWebTabContexts,
  normalizeUrlString,
  normalizeWebTabContext,
} from "@/utils/urlNormalization";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { isAllowedFileForNoteContext } from "@/utils";
import { getFileIdentityKey } from "@/utils/fileListUtils";
import { CornerDownLeft, Square, X } from "lucide-react";
import { App, TFile, TFolder } from "obsidian";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  $getRoot,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  LexicalEditor as LexicalEditorType,
} from "lexical";
import { ContextControl } from "./ContextControl";
import { AddContextButton } from "./AddContextButton";
import { openImagePicker } from "./openImagePicker";
import { shouldShowAtMentionTools } from "./hooks/useAtMentionCategories";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import { AgentLabel, type AgentLabelProps } from "@/components/ui/AgentRoster";
import { BUILTIN_AGENT_SLUG } from "@/agents/types";
import { ModePicker } from "@/components/ui/ModePicker";
import { $removePillsByPath } from "./pills/NotePillNode";
import { $removeActiveNotePills } from "./pills/ActiveNotePillNode";
import { $removePillsByURL } from "./pills/URLPillNode";
import { $removePillsByFolder } from "./pills/FolderPillNode";
import { $removePillsByToolName, $createToolPillNode } from "./pills/ToolPillNode";
import { $removeActiveWebTabPills } from "./pills/ActiveWebTabPillNode";
import { $findWebTabPills, $removeWebTabPillsByUrl } from "./pills/WebTabPillNode";
import LexicalEditor from "./LexicalEditor";
import { cn } from "@/lib/utils";
import { type AgentMentionState, NO_AGENT_MENTIONS } from "./hooks/useAtMentionCategories";
import { $createAgentPillNode } from "./pills/AgentPillNode";

const ACCENT_CIRCLE_BUTTON_CLASS =
  "tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover";

const DEFAULT_PLACEHOLDER =
  "Your AI assistant for Obsidian • @ to add context • / for custom prompts";

export interface ChatInputProps {
  topRightAccessory?: React.ReactNode;
  placeholder?: string;
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: (metadata?: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
    contextFolders?: string[];
    webTabs?: WebTabContext[];
  }) => void;
  isGenerating: boolean;
  onStopGenerating: () => void;
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  includeActiveWebTab: boolean;
  setIncludeActiveWebTab: (include: boolean) => void;
  activeWebTab: WebTabContext | null;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  disableModelSwitch?: boolean;
  modelPickerOverride?: {
    models: ModelSelectorEntry[];
    value: string;
    onChange: (modelKey: string) => void;
    disabled?: boolean;
    effort?: {
      options: { label: string; value: string | null }[];
      value: string | null;
      onChange: (value: string | null) => void;
      disabled?: boolean;
    };
    effortOptionsByModelKey?: Record<string, { label: string; value: string | null }[]>;
    commitSelection?: (modelKey: string, effort: string | null) => void;
  };
  agent?: Omit<AgentLabelProps, "builtin"> & { slug: string; showLabel: boolean };
  modePickerOverride?: {
    options: { label: string; value: CopilotMode }[];
    value: CopilotMode | null;
    onChange: (value: CopilotMode) => void;
    disabled?: boolean;
  };
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;

  toolControls?: React.ReactNode;

  onToolPillsChange?: (toolNames: string[]) => void;

  onTagSelected?: () => void;

  onEscape?: () => void;
  onShiftTab?: () => void;

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

  isAgentMode?: boolean;

  agentMentions?: AgentMentionState;

  onMentionedAgentsChange?: (slugs: string[]) => void;
}

export interface ChatInputHandle {
  removeToolPills(toolNames: string[]): void;
  prependContent(
    text: string,
    agentIds: readonly string[],
    webTabs: readonly WebTabContext[]
  ): void;
}

const ChatInput = React.forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    topRightAccessory,
    placeholder = DEFAULT_PLACEHOLDER,
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
    includeActiveWebTab,
    setIncludeActiveWebTab,
    activeWebTab,
    selectedImages,
    onAddImage,
    setSelectedImages,
    disableModelSwitch,
    modelPickerOverride,
    agent,
    modePickerOverride,
    selectedTextContexts,
    onRemoveSelectedText,
    toolControls,
    onToolPillsChange,
    onTagSelected,
    onEscape,
    onShiftTab,
    editMode = false,
    onEditSave,
    onEditCancel,
    initialContext,
    isAgentMode = false,
    agentMentions = NO_AGENT_MENTIONS,
    onMentionedAgentsChange,
  },
  ref
) {
  const [contextUrls, setContextUrls] = useState<string[]>(initialContext?.urls || []);
  const [contextFolders, setContextFolders] = useState<string[]>(initialContext?.folders || []);
  const [contextWebTabs, setContextWebTabs] = useState<WebTabContext[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditorType | null>(null);
  const [currentModelKey, setCurrentModelKey] = useModelKey();
  const settings = useSettingsValue();
  const [currentChain] = useChainType();
  const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(() => {
    const activeFile = app.workspace.getActiveFile();
    return isAllowedFileForNoteContext(activeFile) ? activeFile : null;
  });
  const [notesFromPills, setNotesFromPills] = useState<{ path: string; basename: string }[]>([]);
  const [urlsFromPills, setUrlsFromPills] = useState<string[]>([]);
  const [foldersFromPills, setFoldersFromPills] = useState<string[]>([]);
  const [webTabsFromPills, setWebTabsFromPills] = useState<WebTabContext[]>([]);
  const isCopilotPlus = isPlusChain(currentChain);
  const showAtMentionTools = shouldShowAtMentionTools({ isCopilotPlus, isAgentMode });

  const mergedContextWebTabs = useMemo(() => {
    return mergeWebTabContexts([...contextWebTabs, ...webTabsFromPills]);
  }, [contextWebTabs, webTabsFromPills]);

  const getWebTabsFromEditorSnapshot = (): WebTabContext[] => {
    const editor = lexicalEditorRef.current;
    if (!editor) {
      return webTabsFromPills;
    }

    return editor.read((): WebTabContext[] => {
      const pills = $findWebTabPills();
      return pills.map((pill) => ({
        url: pill.getURL(),
        title: pill.getTitle(),
        faviconUrl: pill.getFaviconUrl(),
      }));
    });
  };

  const onSendMessage = () => {
    if (editMode && onEditSave) {
      onEditSave(inputMessage, {
        notes: contextNotes,
        urls: contextUrls,
        folders: contextFolders,
      });
      return;
    }

    const webTabsFromEditor = getWebTabsFromEditorSnapshot();
    const allWebTabs = mergeWebTabContexts([...contextWebTabs, ...webTabsFromEditor]);

    if (!isCopilotPlus) {
      handleSendMessage({
        webTabs: allWebTabs,
      });
      return;
    }

    handleSendMessage({
      contextNotes,
      urls: contextUrls,
      contextFolders,
      webTabs: allWebTabs,
    });
  };

  const handleNotePillsRemoved = (removedNotes: { path: string; basename: string }[]) => {
    const removedPaths = new Set(removedNotes.map((note) => note.path));

    setContextNotes((prev) => {
      return prev.filter((contextNote) => {
        return !removedPaths.has(contextNote.path);
      });
    });
  };

  const handleAgentsChange = useCallback(
    (slugs: string[]) => {
      onMentionedAgentsChange?.(slugs);
    },
    [onMentionedAgentsChange]
  );

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

  const handleContextNoteRemoved = (notePath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByPath(notePath);
      });
    }

    setNotesFromPills((prev) => prev.filter((note) => note.path !== notePath));
  };

  const handleURLContextRemoved = (url: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByURL(url);
      });
    }

    setUrlsFromPills((prev) => prev.filter((pillUrl) => pillUrl !== url));
  };

  const handleFolderContextRemoved = (folderPath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByFolder(folderPath);
      });
    }

    setFoldersFromPills((prev) => prev.filter((pillFolder) => pillFolder !== folderPath));
  };

  const handleAddToContext = (
    category: string,
    data: TFile | string | TFolder | WebTabContext | null
  ) => {
    switch (category) {
      case "activeNote":
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
                return prev;
              } else {
                return [...prev, data];
              }
            });
          }
        }
        break;
      case "tools":
        if (typeof data === "string" && lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              const toolPill = $createToolPillNode(data);
              selection.insertNodes([toolPill]);
            }
          });
        }
        break;
      case "agents":
        if (typeof data === "string" && lexicalEditorRef.current) {
          const agent = agentMentions.entries.find((entry) => entry.slug === data);
          lexicalEditorRef.current.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createAgentPillNode(data, agent?.name ?? data, agent?.icon ?? ""),
              ]);
            }
          });
        }
        break;
      case "folders":
        if (data && typeof (data as { path?: unknown }).path === "string") {
          const folderPath = (data as { path: string }).path;
          setContextFolders((prev) => {
            const exists = prev.find((f) => f === folderPath);
            if (!exists) {
              return [...prev, folderPath];
            }
            return prev;
          });
        }
        break;
      case "webTabs":
        if (
          data &&
          typeof data === "object" &&
          "url" in data &&
          typeof (data as { url: unknown }).url === "string"
        ) {
          const normalized = normalizeWebTabContext(data);
          if (!normalized) break;

          const activeUrl = normalizeUrlString(activeWebTab?.url);
          if (activeUrl && normalized.url === activeUrl) {
            setIncludeActiveWebTab(true);
            setContextWebTabs((prev) =>
              prev.filter((t) => normalizeUrlString(t.url) !== activeUrl)
            );
            break;
          }

          setContextWebTabs((prev) => mergeWebTabContexts([...prev, normalized]));
        }
        break;
      case "activeWebTab":
        setIncludeActiveWebTab(true);
        {
          const activeUrl = normalizeUrlString(activeWebTab?.url);
          if (activeUrl) {
            setContextWebTabs((prev) =>
              prev.filter((t) => normalizeUrlString(t.url) !== activeUrl)
            );
          }
        }
        break;
      case "images": {
        const doc = containerRef.current?.doc;
        if (!doc) break;
        openImagePicker(doc, {
          onFiles: onAddImage,
          // Cancelling the dialog leaves the pane unresponsive unless focus returns to the composer.
          // https://github.com/logancyang/obsidian-copilot-preview/issues/119
          onSettle: () => lexicalEditorRef.current?.focus(),
        });
        break;
      }
    }
  };

  const handleRemoveFromContext = (category: string, data: string) => {
    switch (category) {
      case "activeNote":
        setIncludeActiveNote(false);
        if (lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            $removeActiveNotePills();
          });
        }
        break;
      case "notes":
        if (typeof data === "string") {
          if (currentActiveNote?.path === data && includeActiveNote) {
            setIncludeActiveNote(false);
          } else {
            setContextNotes((prev) => prev.filter((note) => note.path !== data));
          }
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
          setContextFolders((prev) => prev.filter((f) => f !== data));
          handleFolderContextRemoved(data);
        }
        break;
      case "selectedText":
        if (typeof data === "string") {
          onRemoveSelectedText?.(data);
        }
        break;
      case "activeWebTab":
        setIncludeActiveWebTab(false);
        if (lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            $removeActiveWebTabPills();
          });
        }
        break;
      case "webTabs":
        if (typeof data === "string") {
          const url = normalizeUrlString(data);
          if (!url) break;

          setContextWebTabs((prev) => prev.filter((t) => normalizeUrlString(t.url) !== url));
          setWebTabsFromPills((prev) => prev.filter((t) => normalizeUrlString(t.url) !== url));
          if (lexicalEditorRef.current) {
            lexicalEditorRef.current.update(() => {
              $removeWebTabPillsByUrl(url);
            });
          }
        }
        break;
    }
  };

  const handleFolderPillsRemoved = (removedFolders: string[]) => {
    const removedFolderPaths = new Set(removedFolders);

    setContextFolders((prev) => {
      return prev.filter((folder) => {
        if (removedFolderPaths.has(folder)) {
          return false;
        }
        return true;
      });
    });
  };

  useEffect(() => {
    setContextNotes((prev) => {
      const contextPaths = new Set(prev.map((note) => note.path));

      const newNotesFromPills = notesFromPills.filter((pillNote) => {
        return !contextPaths.has(pillNote.path);
      });

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

  useEffect(() => {
    if (isPlusChain(currentChain)) {
      // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- merge pill URLs into user-owned context without removing manual entries
      setContextUrls((prev) => {
        const contextUrlSet = new Set(prev);
        const newUrlsFromPills = urlsFromPills.filter((pillUrl) => !contextUrlSet.has(pillUrl));
        if (newUrlsFromPills.length > 0) {
          return Array.from(new Set([...prev, ...newUrlsFromPills]));
        }
        return prev;
      });
    } else {
      // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- clear Plus-only URL context when switching chains
      setContextUrls([]);
    }
  }, [urlsFromPills, currentChain]);

  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- merge pill folders into user-owned context without removing manual entries
    setContextFolders((prev) => {
      const contextFolderPaths = new Set(prev);
      const newFoldersFromPills = foldersFromPills.filter(
        (pillFolder) => !contextFolderPaths.has(pillFolder)
      );
      return [...prev, ...newFoldersFromPills];
    });
  }, [foldersFromPills]);

  useEffect(() => {
    let timeoutId: number;

    const handleActiveLeafChange = () => {
      window.clearTimeout(timeoutId);

      timeoutId = window.setTimeout(() => {
        const activeNote = app.workspace.getActiveFile();
        setCurrentActiveNote(isAllowedFileForNoteContext(activeNote) ? activeNote : null);
      }, 100);
    };

    const eventRef = app.workspace.on("active-leaf-change", handleActiveLeafChange);

    return () => {
      window.clearTimeout(timeoutId);
      app.workspace.offref(eventRef);
    };
  }, [app.workspace]);

  const onEditorReady = useCallback((editor: LexicalEditorType) => {
    lexicalEditorRef.current = editor;
  }, []);

  useEffect(() => {
    if (!editMode || !onEditCancel) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEditCancel();
      }
    };

    const doc = containerRef.current?.doc;
    if (!doc) return;
    // Capture edit cancellation before the composer contains Escape at its own boundary.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/302
    doc.addEventListener("keydown", handleKeyDown, true);
    return () => doc.removeEventListener("keydown", handleKeyDown, true);
  }, [editMode, onEditCancel]);

  useImperativeHandle(
    ref,
    () => ({
      prependContent(text, agentSlugs, webTabs) {
        setContextWebTabs((previous) => mergeWebTabContexts([...webTabs, ...previous]));
        lexicalEditorRef.current?.update(
          () => {
            // Preserve the current draft's structured pills when restoring a stopped queue.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/485
            const root = $getRoot();
            const pills = agentSlugs.map((slug) => {
              const agent = agentMentions.entries.find((entry) => entry.slug === slug);
              return $createAgentPillNode(slug, agent?.name ?? slug, agent?.icon ?? "");
            });
            const separator = root.getTextContent().trim() ? "\n\n" : "";
            root.selectStart().insertNodes([...pills, $createTextNode(text + separator)]);
            setInputMessage(root.getTextContent());
          },
          { discrete: true }
        );
      },
      removeToolPills(toolNames: string[]) {
        if (!lexicalEditorRef.current) return;
        lexicalEditorRef.current.update(() => {
          toolNames.forEach((name) => $removePillsByToolName(name));
        });
      },
    }),
    [agentMentions, setInputMessage]
  );

  const handleActiveNoteAdded = useCallback(() => {
    setIncludeActiveNote(true);
  }, [setIncludeActiveNote]);

  const handleActiveNoteRemoved = useCallback(() => {
    setIncludeActiveNote(false);
  }, [setIncludeActiveNote]);

  const handleActiveWebTabAdded = useCallback(() => {
    setIncludeActiveWebTab(true);
  }, [setIncludeActiveWebTab]);

  const handleActiveWebTabRemoved = useCallback(() => {
    setIncludeActiveWebTab(false);
  }, [setIncludeActiveWebTab]);

  return (
    <div
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-gap-0.5 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-1 tw-pb-1 tw-pt-2 tw-@container/chat-input",
        modePickerOverride?.value === "plan" &&
          "tw-shadow-[0_0_10px_rgba(var(--color-blue-rgb),0.18)] tw-border-blue/60",
        modePickerOverride?.value === "auto" &&
          "tw-shadow-[0_0_10px_rgba(var(--color-red-rgb),0.18)] tw-border-red/60"
      )}
      ref={containerRef}
    >
      <div className="tw-flex tw-gap-1">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
          {!editMode && (
            <ContextControl
              contextNotes={contextNotes}
              includeActiveNote={includeActiveNote}
              activeNote={currentActiveNote}
              includeActiveWebTab={includeActiveWebTab}
              activeWebTab={activeWebTab}
              contextUrls={contextUrls}
              contextFolders={contextFolders}
              contextWebTabs={mergedContextWebTabs}
              selectedTextContexts={selectedTextContexts}
              onAddToContext={handleAddToContext}
              onRemoveFromContext={handleRemoveFromContext}
              hideAddContextButton={isAgentMode}
              isAgentMode={isAgentMode}
            />
          )}

          {selectedImages.length > 0 && (
            <div className="selected-images">
              {selectedImages.map((file, index) => (
                <div key={getFileIdentityKey(file)} className="image-preview-container">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="selected-image-preview"
                  />
                  <button
                    type="button"
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

          <div className="tw-relative">
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
              onToolsChange={isCopilotPlus ? onToolPillsChange : undefined}
              onFoldersChange={setFoldersFromPills}
              onFoldersRemoved={handleFolderPillsRemoved}
              onWebTabsChange={setWebTabsFromPills}
              onActiveWebTabAdded={handleActiveWebTabAdded}
              onActiveWebTabRemoved={handleActiveWebTabRemoved}
              agentMentions={agentMentions}
              onAgentsChange={handleAgentsChange}
              onEditorReady={onEditorReady}
              onImagePaste={onAddImage}
              onTagSelected={onTagSelected}
              placeholder={placeholder}
              isCopilotPlus={isCopilotPlus}
              showTools={showAtMentionTools}
              currentActiveFile={currentActiveNote}
              currentChain={currentChain}
              onEscape={onEscape}
              onShiftTab={onShiftTab}
            />
          </div>
        </div>

        {topRightAccessory && (
          <div className="-tw-ml-4 tw-w-6 tw-shrink-0 tw-self-start">{topRightAccessory}</div>
        )}
      </div>

      <div className="tw-flex tw-h-7 tw-justify-between tw-gap-1 tw-px-1">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
          {!editMode && (
            <AddContextButton
              onSelect={handleAddToContext}
              isCopilotPlus={isCopilotPlus}
              showTools={showAtMentionTools}
              currentActiveFile={currentActiveNote}
              lexicalEditorRef={lexicalEditorRef}
            />
          )}
          {agent?.showLabel && (
            <AgentLabel
              name={agent.name}
              avatarSrc={agent.avatarSrc}
              builtin={agent.slug === BUILTIN_AGENT_SLUG}
            />
          )}
          {modelPickerOverride?.effortOptionsByModelKey && modelPickerOverride.commitSelection ? (
            <ModelEffortPicker
              override={{
                models: modelPickerOverride.models,
                value: modelPickerOverride.value,
                disabled: modelPickerOverride.disabled,
                effort: modelPickerOverride.effort,
                effortOptionsByModelKey: modelPickerOverride.effortOptionsByModelKey,
                commitSelection: modelPickerOverride.commitSelection,
              }}
              className="tw-min-w-0 tw-max-w-full tw-truncate"
            />
          ) : (
            <ModelSelector
              variant="ghost2"
              size="fit"
              disabled={modelPickerOverride?.disabled ?? disableModelSwitch}
              value={modelPickerOverride?.value ?? currentModelKey}
              models={modelPickerOverride?.models ?? settings.activeModels}
              apiKeySettings={modelPickerOverride ? undefined : settings}
              onChange={modelPickerOverride?.onChange ?? setCurrentModelKey}
              className="tw-min-w-0 tw-max-w-full tw-truncate"
            />
          )}
        </div>

        <div className="tw-flex tw-items-center tw-gap-1">
          {!isGenerating && toolControls}
          {modePickerOverride && <ModePicker override={modePickerOverride} />}
          {isGenerating ? (
            <Button
              size="icon"
              className={cn(ACCENT_CIRCLE_BUTTON_CLASS)}
              aria-label="Stop generating"
              onClick={() => onStopGenerating()}
            >
              <Square className="tw-size-3 tw-fill-current" />
            </Button>
          ) : (
            <>
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
              {editMode ? (
                <Button
                  variant="ghost2"
                  size="fit"
                  className="tw-text-muted"
                  onClick={() => onSendMessage()}
                >
                  <CornerDownLeft className="!tw-size-3" />
                  <span>save</span>
                </Button>
              ) : (
                <ChatSendButton
                  inputMessage={inputMessage}
                  imageCount={selectedImages.length}
                  onSend={() => onSendMessage()}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatInput;
