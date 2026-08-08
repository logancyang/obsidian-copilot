import React, { useCallback, useEffect, useId } from "react";
import { $getRoot, EditorState, LexicalEditor as LexicalEditorType } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TFile } from "obsidian";
import type { WebTabContext } from "@/types/message";
import { SlashCommandPlugin } from "./plugins/SlashCommandPlugin";
import { NoteCommandPlugin } from "./plugins/NoteCommandPlugin";
import { TagCommandPlugin } from "./plugins/TagCommandPlugin";
import { AtMentionCommandPlugin } from "./plugins/AtMentionCommandPlugin";
import { NotePillNode } from "./pills/NotePillNode";
import { URLPillNode } from "./pills/URLPillNode";
import { ToolPillNode } from "./pills/ToolPillNode";
import { FolderPillNode } from "./pills/FolderPillNode";
import { ActiveNotePillNode } from "./pills/ActiveNotePillNode";
import { WebTabPillNode } from "./pills/WebTabPillNode";
import { ActiveWebTabPillNode } from "./pills/ActiveWebTabPillNode";
import { AgentPillNode } from "./pills/AgentPillNode";
import { PillDeletionPlugin } from "./plugins/PillDeletionPlugin";
import { KeyboardPlugin } from "./plugins/KeyboardPlugin";
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin";
import { FocusPlugin } from "./plugins/FocusPlugin";
import { NotePillSyncPlugin } from "./plugins/NotePillSyncPlugin";
import { URLPillSyncPlugin } from "./plugins/URLPillSyncPlugin";
import { ToolPillSyncPlugin } from "./plugins/ToolPillSyncPlugin";
import { FolderPillSyncPlugin } from "./plugins/FolderPillSyncPlugin";
import { ActiveNotePillSyncPlugin } from "./plugins/ActiveNotePillSyncPlugin";
import { WebTabPillSyncPlugin } from "./plugins/WebTabPillSyncPlugin";
import { AgentPillSyncPlugin } from "./plugins/AgentPillSyncPlugin";
import { PastePlugin } from "./plugins/PastePlugin";
import { PromptSuggestionPlaceholder } from "./PromptSuggestionPlaceholder";
import { TextInsertionPlugin } from "./plugins/TextInsertionPlugin";
import { useChatInput } from "@/context/ChatInputContext";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { ActiveFileProvider } from "./context/ActiveFileContext";
import { CloudAgentProvider, EMPTY_CLOUD_AGENT_IDS } from "./context/CloudAgentContext";
import { ChainType } from "@/chainType";
import { useSettingsValue } from "@/settings/model";
import { type AgentMentionBrand, EMPTY_AGENT_MENTION_BRANDS } from "./hooks/useAtMentionCategories";

interface LexicalEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /**
   * Sample prompts to type out in the placeholder, one at a time, while the
   * editor is empty (Tab accepts the one on screen). When set and non-empty it
   * replaces `placeholder`. Must be referentially stable — see
   * {@link PromptSuggestionPlaceholder}.
   */
  placeholderPrompts?: readonly string[];
  disabled?: boolean;
  className?: string;
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
  onURLsChange?: (urls: string[]) => void;
  onURLsRemoved?: (removedUrls: string[]) => void;
  onToolsChange?: (tools: string[]) => void;
  onToolsRemoved?: (removedTools: string[]) => void;
  onFoldersChange?: (folders: string[]) => void;
  onFoldersRemoved?: (removedFolders: string[]) => void;
  onActiveNoteAdded?: () => void;
  onActiveNoteRemoved?: () => void;
  onWebTabsChange?: (webTabs: WebTabContext[]) => void;
  onWebTabsRemoved?: (removedWebTabs: WebTabContext[]) => void;
  onActiveWebTabAdded?: () => void;
  onActiveWebTabRemoved?: () => void;
  onAgentsChange?: (backendIds: string[]) => void;
  /** Installed coding agents mentionable in the composer (Agent Mode only). */
  agentBrands?: ReadonlyArray<AgentMentionBrand>;
  /** Cloud (non-self-hostable) agent backend ids — the full registry set, not
   *  just installed ones, so a stale/pasted pill still resolves. Drives the
   *  Self-Host cloud-egress warning on agent pills. */
  cloudAgentIds?: ReadonlySet<string>;
  onEditorReady?: (editor: LexicalEditorType) => void;
  onImagePaste?: (files: File[]) => void;
  onTagSelected?: () => void;
  isCopilotPlus?: boolean;
  /** Whether to surface Copilot built-in `@` tools in the typeahead. */
  showTools?: boolean;
  currentActiveFile?: TFile | null;
  currentChain?: ChainType;
  onEscape?: () => void;
  onShiftTab?: () => void;
}

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  placeholderPrompts,
  disabled = false,
  className = "",
  onNotesChange,
  onNotesRemoved,
  onURLsChange,
  onURLsRemoved,
  onToolsChange,
  onToolsRemoved,
  onFoldersChange,
  onFoldersRemoved,
  onActiveNoteAdded,
  onActiveNoteRemoved,
  onWebTabsChange,
  onWebTabsRemoved,
  onActiveWebTabAdded,
  onActiveWebTabRemoved,
  onAgentsChange,
  agentBrands = EMPTY_AGENT_MENTION_BRANDS,
  cloudAgentIds = EMPTY_CLOUD_AGENT_IDS,
  onEditorReady,
  onImagePaste,
  onTagSelected,
  isCopilotPlus = false,
  showTools = false,
  currentActiveFile = null,
  currentChain,
  onEscape,
  onShiftTab,
}) => {
  const [focusFn, setFocusFn] = React.useState<(() => void) | null>(null);
  const [editorInstance, setEditorInstance] = React.useState<LexicalEditorType | null>(null);
  const chatInputContext = useChatInput();
  const settings = useSettingsValue();

  // Wrapper to properly set function state (avoids React's updater function interpretation)
  const handleFocusRegistration = React.useCallback((fn: () => void) => {
    setFocusFn(() => fn);
  }, []);

  // Register editor and focus handler with context
  useEffect(() => {
    if (editorInstance) {
      chatInputContext.registerEditor(editorInstance);
    }
  }, [editorInstance, chatInputContext]);

  useEffect(() => {
    if (focusFn) {
      chatInputContext.registerFocusHandler(focusFn);
    }
  }, [focusFn, chatInputContext]);

  const initialConfig = React.useMemo(
    () => ({
      namespace: "ChatEditor",
      theme: {
        root: "tw-outline-none",
        paragraph: "tw-m-0",
      },
      nodes: [
        NotePillNode,
        ActiveNotePillNode,
        ToolPillNode,
        FolderPillNode,
        WebTabPillNode,
        ActiveWebTabPillNode,
        AgentPillNode,
        ...(onURLsChange ? [URLPillNode] : []),
      ],
      onError: (error: Error) => {
        logError("Lexical error:", error);
      },
      editable: !disabled,
    }),
    [onURLsChange, disabled]
  );

  const handleEditorChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();
        onChange(textContent);
      });
    },
    [onChange]
  );

  // Unique per editor: Agent Home and a popout composer can be mounted at once,
  // and a duplicated id would point both at the first one's description.
  const promptSuggestionId = useId();
  const showPromptSuggestions = !!placeholderPrompts && placeholderPrompts.length > 0;

  // Obsidian pops its own tooltip for anything carrying `aria-label`, which is
  // noise on an element the size of the composer — name it out of band instead.
  const editorLabelId = useId();

  const handleEditorReady = useCallback(
    (editor: LexicalEditorType) => {
      setEditorInstance(editor);
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ActiveFileProvider currentActiveFile={currentActiveFile}>
        <CloudAgentProvider cloudAgentIds={cloudAgentIds}>
          <div className={cn("tw-relative", className)}>
            <span id={editorLabelId} className="tw-sr-only">
              Chat input
            </span>
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  className="tw-max-h-60 tw-min-h-[60px] tw-w-full tw-resize-none tw-overflow-y-auto tw-rounded-md tw-border-none tw-bg-transparent tw-px-2 tw-text-sm tw-text-normal tw-outline-none focus-visible:tw-ring-0"
                  aria-labelledby={editorLabelId}
                  // The suggestions bind Tab, so a screen reader has to hear
                  // what that key will do before it is pressed — the animated
                  // text itself stays hidden.
                  aria-describedby={showPromptSuggestions ? promptSuggestionId : undefined}
                />
              }
              placeholder={
                <div className="tw-pointer-events-none tw-absolute tw-left-2 tw-top-0 tw-select-none tw-text-sm tw-text-muted/60">
                  {showPromptSuggestions ? (
                    <PromptSuggestionPlaceholder
                      prompts={placeholderPrompts}
                      descriptionId={promptSuggestionId}
                    />
                  ) : (
                    placeholder
                  )}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {/* ignoreSelectionChange: only text edits should push into `value`.
                Selection/focus-only changes carry the same text, and firing
                onChange for them lets stale editor text race a just-issued
                external clear back into the controlled value (#211). */}
            <OnChangePlugin onChange={handleEditorChange} ignoreSelectionChange />
            <HistoryPlugin />
            <KeyboardPlugin
              onSubmit={onSubmit}
              sendShortcut={settings.defaultSendShortcut}
              onEscape={onEscape}
              onShiftTab={onShiftTab}
            />
            <ValueSyncPlugin value={value} />
            <FocusPlugin onFocus={handleFocusRegistration} onEditorReady={handleEditorReady} />
            <NotePillSyncPlugin onNotesChange={onNotesChange} onNotesRemoved={onNotesRemoved} />
            {onURLsChange && (
              <URLPillSyncPlugin onURLsChange={onURLsChange} onURLsRemoved={onURLsRemoved} />
            )}
            <ToolPillSyncPlugin onToolsChange={onToolsChange} onToolsRemoved={onToolsRemoved} />
            <FolderPillSyncPlugin
              onFoldersChange={onFoldersChange}
              onFoldersRemoved={onFoldersRemoved}
            />
            <ActiveNotePillSyncPlugin
              onActiveNoteAdded={onActiveNoteAdded}
              onActiveNoteRemoved={onActiveNoteRemoved}
            />
            <WebTabPillSyncPlugin
              onWebTabsChange={onWebTabsChange}
              onWebTabsRemoved={onWebTabsRemoved}
              onActiveWebTabAdded={onActiveWebTabAdded}
              onActiveWebTabRemoved={onActiveWebTabRemoved}
            />
            <AgentPillSyncPlugin onAgentsChange={onAgentsChange} />
            <PillDeletionPlugin />
            <PastePlugin enableURLPills={!!onURLsChange} onImagePaste={onImagePaste} />
            <SlashCommandPlugin />
            <NoteCommandPlugin
              isCopilotPlus={isCopilotPlus}
              currentActiveFile={currentActiveFile}
            />
            {currentChain && currentChain !== ChainType.LLM_CHAIN && (
              <TagCommandPlugin onTagSelected={onTagSelected} />
            )}
            <AtMentionCommandPlugin
              isCopilotPlus={isCopilotPlus}
              showTools={showTools}
              currentActiveFile={currentActiveFile}
              agentBrands={agentBrands}
            />
            <TextInsertionPlugin />
          </div>
        </CloudAgentProvider>
      </ActiveFileProvider>
    </LexicalComposer>
  );
};

export default LexicalEditor;
