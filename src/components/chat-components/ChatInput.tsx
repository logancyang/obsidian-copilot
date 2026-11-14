import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { useChainType } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
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
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  $getRoot,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  LexicalEditor as LexicalEditorType,
} from "lexical";
import { ContextControl } from "./ContextControl";
import { AddContextButton } from "./AddContextButton";
import { attachToChat, CONTEXT_FILE_ACCEPT } from "./attachToChat";
import { splitByVault } from "@/utils/splitByVault";
import { openFilePicker } from "./openFilePicker";
import { shouldShowAtMentionTools } from "./hooks/useAtMentionCategories";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import { ModePicker } from "@/components/ui/ModePicker";
import { $removePillsByToolName, $createToolPillNode } from "./pills/ToolPillNode";
import { $findWebTabPills } from "./pills/WebTabPillNode";
import LexicalEditor from "./LexicalEditor";
import { cn } from "@/lib/utils";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { type AgentMentionBrand, EMPTY_AGENT_MENTION_BRANDS } from "./hooks/useAtMentionCategories";
import { EMPTY_CLOUD_AGENT_IDS } from "./context/CloudAgentContext";
import { $createAgentPillNode } from "./pills/AgentPillNode";

const ACCENT_CIRCLE_BUTTON_CLASS =
  "tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover";

const NO_MODELS: ModelSelectorEntry[] = [];

const NOOP = () => {};

const DEFAULT_PLACEHOLDER =
  "Your AI assistant for Obsidian • @ to add context • / for custom prompts";

export interface ChatInputProps {
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
  contextFolders?: string[];
  setContextFolders?: React.Dispatch<React.SetStateAction<string[]>>;
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
  projectFolderPath?: string;

  agentBrands?: ReadonlyArray<AgentMentionBrand>;

  cloudAgentIds?: ReadonlySet<string>;

  onMentionedAgentsChange?: (backendIds: string[]) => void;
}

interface SelectedImagePreviewProps {
  file: File;
}

function SelectedImagePreview({ file }: SelectedImagePreviewProps) {
  const url = useObjectUrl(file);
  return <img src={url} alt={file.name} className="selected-image-preview" />;
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
    placeholder = DEFAULT_PLACEHOLDER,
    inputMessage,
    setInputMessage,
    handleSendMessage,
    isGenerating,
    onStopGenerating,
    app,
    contextNotes,
    setContextNotes,
    contextFolders: draftContextFolders,
    setContextFolders: setDraftContextFolders,
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
    projectFolderPath,
    agentBrands = EMPTY_AGENT_MENTION_BRANDS,
    cloudAgentIds = EMPTY_CLOUD_AGENT_IDS,
    onMentionedAgentsChange,
  },
  ref
) {
  const [contextUrls, setContextUrls] = useState<string[]>(initialContext?.urls || []);
  const [ownContextFolders, setOwnContextFolders] = useState<string[]>(
    initialContext?.folders || []
  );
  // Agent Chat keeps folders in the chat's draft so they are sent with the message and survive a switch to another chat.
  // https://github.com/logancyang/obsidian-copilot/issues/3858
  const contextFolders = draftContextFolders ?? ownContextFolders;
  const setContextFolders = setDraftContextFolders ?? setOwnContextFolders;
  const [contextWebTabs, setContextWebTabs] = useState<WebTabContext[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditorType | null>(null);
  const [currentChain] = useChainType();
  const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(() => {
    const activeFile = app.workspace.getActiveFile();
    return isAllowedFileForNoteContext(activeFile) ? activeFile : null;
  });
  const [mentionedNotes, setMentionedNotes] = useState<{ mentionPath: string; file: TFile }[]>([]);
  // A mention keeps the file it was resolved to, so a note renamed before sending is still sent.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/932
  const handleNoteMentionsChange = useCallback(
    (mentions: { path: string }[]) =>
      setMentionedNotes((previous) =>
        mentions.flatMap(({ path }) => {
          const known = previous.find((mention) => mention.mentionPath === path);
          if (known) return [known];
          const file = app.vault.getAbstractFileByPath(path);
          return file instanceof TFile ? [{ mentionPath: path, file }] : [];
        })
      ),
    [app.vault]
  );
  const [urlsFromPills, setUrlsFromPills] = useState<string[]>([]);
  const [foldersFromPills, setFoldersFromPills] = useState<string[]>([]);
  const [webTabsFromPills, setWebTabsFromPills] = useState<WebTabContext[]>([]);
  const isCopilotPlus = isPlusChain(currentChain);
  const showAtMentionTools = shouldShowAtMentionTools({ isCopilotPlus, isAgentMode });

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

  // A phone may have no Enter key, so a draft turns Stop into a Send that does what Enter does. https://github.com/Brevilabs/obsidian-copilot-private/issues/788
  const showsStop =
    isGenerating && !(isAgentMode && (inputMessage.trim().length > 0 || selectedImages.length > 0));

  const onSendMessage = () => {
    // A mention is sent as context with the message but never shown as a badge, so it joins the attached context only here.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/932
    const mentionedFiles = mentionedNotes.map((mention) => mention.file);
    const notes = [
      ...contextNotes,
      ...mentionedFiles.filter((note) => !contextNotes.some((n) => n.path === note.path)),
    ];
    const urls = [...new Set([...contextUrls, ...urlsFromPills])];
    const folders = [...new Set([...contextFolders, ...foldersFromPills])];

    if (editMode && onEditSave) {
      onEditSave(inputMessage, { notes, urls, folders });
      return;
    }

    const webTabsFromEditor = getWebTabsFromEditorSnapshot();
    const allWebTabs = mergeWebTabContexts([...contextWebTabs, ...webTabsFromEditor]);

    if (!isCopilotPlus) {
      handleSendMessage({
        webTabs: allWebTabs,
        contextNotes: mentionedFiles,
        ...(isAgentMode ? { contextFolders: foldersFromPills } : {}),
      });
      return;
    }

    handleSendMessage({ contextNotes: notes, urls, contextFolders: folders, webTabs: allWebTabs });
  };

  const handleAgentsChange = useCallback(
    (backendIds: string[]) => {
      onMentionedAgentsChange?.(backendIds);
    },
    [onMentionedAgentsChange]
  );

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
          const label = agentBrands.find((b) => b.id === data)?.displayName ?? data;
          lexicalEditorRef.current.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertNodes([$createAgentPillNode(data, label)]);
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
      case "files": {
        const doc = containerRef.current?.doc;
        if (!doc) break;
        openFilePicker(doc, {
          accept: isAgentMode ? undefined : CONTEXT_FILE_ACCEPT,
          onFiles: (files) =>
            void attachToChat(app, splitByVault(app, { files }), {
              contextNotes,
              selectedImages,
              onAddImage,
              setContextNotes,
              acceptAnyFileType: isAgentMode,
              projectFolderPath,
            }),
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
        break;
      case "notes":
        if (typeof data === "string") {
          if (currentActiveNote?.path === data && includeActiveNote) {
            setIncludeActiveNote(false);
          } else {
            setContextNotes((prev) => prev.filter((note) => note.path !== data));
          }
        }
        break;
      case "urls":
        if (typeof data === "string") {
          setContextUrls((prev) => prev.filter((u) => u !== data));
        }
        break;
      case "folders":
        if (typeof data === "string") {
          setContextFolders((prev) => prev.filter((f) => f !== data));
        }
        break;
      case "selectedText":
        if (typeof data === "string") {
          onRemoveSelectedText?.(data);
        }
        break;
      case "activeWebTab":
        setIncludeActiveWebTab(false);
        break;
      case "webTabs":
        if (typeof data === "string") {
          const url = normalizeUrlString(data);
          if (!url) break;

          setContextWebTabs((prev) => prev.filter((t) => normalizeUrlString(t.url) !== url));
        }
        break;
    }
  };

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
      prependContent(text, agentIds, webTabs) {
        setContextWebTabs((previous) => mergeWebTabContexts([...webTabs, ...previous]));
        lexicalEditorRef.current?.update(
          () => {
            // Preserve the current draft's structured pills when restoring a stopped queue.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/485
            const root = $getRoot();
            const pills = agentIds.map((id) =>
              $createAgentPillNode(id, agentBrands.find((b) => b.id === id)?.displayName ?? id)
            );
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
    [agentBrands, setInputMessage]
  );

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
              contextWebTabs={contextWebTabs}
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
                  <SelectedImagePreview file={file} />
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
              onNotesChange={handleNoteMentionsChange}
              onURLsChange={isCopilotPlus ? setUrlsFromPills : undefined}
              onToolsChange={isCopilotPlus ? onToolPillsChange : undefined}
              onFoldersChange={setFoldersFromPills}
              onWebTabsChange={setWebTabsFromPills}
              agentBrands={agentBrands}
              cloudAgentIds={cloudAgentIds}
              onAgentsChange={handleAgentsChange}
              onEditorReady={onEditorReady}
              onImagePaste={onAddImage}
              onTagSelected={onTagSelected}
              placeholder={placeholder}
              showTools={showAtMentionTools}
              currentActiveFile={currentActiveNote}
              currentChain={currentChain}
              onEscape={onEscape}
              onShiftTab={onShiftTab}
              isAgentMode={isAgentMode}
            />
          </div>
        </div>
      </div>

      <div className="tw-flex tw-h-7 tw-justify-between tw-gap-1 tw-px-1">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
          {!editMode && (
            <AddContextButton
              onSelect={handleAddToContext}
              showTools={showAtMentionTools}
              currentActiveFile={currentActiveNote}
              lexicalEditorRef={lexicalEditorRef}
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
            // Agent Mode has no model list until its session manager exists, so the slot stays empty and disabled.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/761
            <ModelSelector
              variant="ghost2"
              size="fit"
              disabled={
                modelPickerOverride?.disabled ?? (disableModelSwitch || !modelPickerOverride)
              }
              value={modelPickerOverride?.value ?? ""}
              models={modelPickerOverride?.models ?? NO_MODELS}
              onChange={modelPickerOverride?.onChange ?? NOOP}
              className="tw-min-w-0 tw-max-w-full tw-truncate"
            />
          )}
        </div>

        <div className="tw-flex tw-items-center tw-gap-1">
          {!isGenerating && toolControls}
          {modePickerOverride && <ModePicker override={modePickerOverride} />}
          {showsStop ? (
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
                  <span>Cancel</span>
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
                  <span>Save</span>
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
