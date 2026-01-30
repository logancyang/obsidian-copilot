/**
 * QuickAskInput - Lexical-based input component for Quick Ask.
 * Simplified version of LexicalEditor with @ mention support.
 */

import React, { useCallback, useEffect, useState } from "react";
import { $getRoot, EditorState, LexicalEditor as LexicalEditorType } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TFile } from "obsidian";
import { NotePillNode } from "@/components/chat-components/pills/NotePillNode";
import { ActiveNotePillNode } from "@/components/chat-components/pills/ActiveNotePillNode";
import { FolderPillNode } from "@/components/chat-components/pills/FolderPillNode";
import { WebTabPillNode } from "@/components/chat-components/pills/WebTabPillNode";
import { ActiveWebTabPillNode } from "@/components/chat-components/pills/ActiveWebTabPillNode";
import { KeyboardPlugin } from "@/components/chat-components/plugins/KeyboardPlugin";
import { ValueSyncPlugin } from "@/components/chat-components/plugins/ValueSyncPlugin";
import { FocusPlugin } from "@/components/chat-components/plugins/FocusPlugin";
import { NotePillSyncPlugin } from "@/components/chat-components/plugins/NotePillSyncPlugin";
import { FolderPillSyncPlugin } from "@/components/chat-components/plugins/FolderPillSyncPlugin";
import { ActiveNotePillSyncPlugin } from "@/components/chat-components/plugins/ActiveNotePillSyncPlugin";
import { PillDeletionPlugin } from "@/components/chat-components/plugins/PillDeletionPlugin";
import { AtMentionCommandPlugin } from "@/components/chat-components/plugins/AtMentionCommandPlugin";
import { ActiveFileProvider } from "@/components/chat-components/context/ActiveFileContext";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { SEND_SHORTCUT } from "@/constants";

interface QuickAskInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Send shortcut configuration */
  sendShortcut?: SEND_SHORTCUT;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Callback when notes are added via @ mention */
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  /** Callback when notes are removed */
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
  /** Callback when folders are added via @ mention */
  onFoldersChange?: (folders: string[]) => void;
  /** Callback when folders are removed */
  onFoldersRemoved?: (removedFolders: string[]) => void;
  /** Callback when active note is added */
  onActiveNoteAdded?: () => void;
  /** Callback when active note is removed */
  onActiveNoteRemoved?: () => void;
  /** Callback when editor is ready */
  onEditorReady?: (editor: LexicalEditorType) => void;
  /** Current active file for @ mention context */
  currentActiveFile?: TFile | null;
}

/**
 * QuickAskInput - Lexical editor for Quick Ask panel.
 */
export const QuickAskInput = React.memo(function QuickAskInput({
  value,
  onChange,
  onSubmit,
  sendShortcut = SEND_SHORTCUT.ENTER,
  placeholder = "Ask a question...",
  disabled = false,
  className = "",
  onNotesChange,
  onNotesRemoved,
  onFoldersChange,
  onFoldersRemoved,
  onActiveNoteAdded,
  onActiveNoteRemoved,
  onEditorReady,
  currentActiveFile = null,
}: QuickAskInputProps) {
  const [focusFn, setFocusFn] = useState<(() => void) | null>(null);

  // Wrapper to properly set function state
  const handleFocusRegistration = useCallback((fn: () => void) => {
    setFocusFn(() => fn);
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    if (focusFn) {
      const timer = setTimeout(() => {
        focusFn();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [focusFn]);

  const initialConfig = React.useMemo(
    () => ({
      namespace: "QuickAskEditor",
      theme: {
        root: "tw-outline-none",
        paragraph: "tw-m-0",
      },
      nodes: [
        NotePillNode,
        ActiveNotePillNode,
        FolderPillNode,
        WebTabPillNode,
        ActiveWebTabPillNode,
      ],
      onError: (error: Error) => {
        logError("QuickAskInput Lexical error:", error);
      },
      editable: !disabled,
    }),
    [disabled]
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

  const handleEditorReady = useCallback(
    (editor: LexicalEditorType) => {
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ActiveFileProvider currentActiveFile={currentActiveFile}>
        <div className={cn("tw-relative", className)}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className="tw-max-h-48 tw-min-h-12 tw-w-full tw-resize-none tw-overflow-y-auto tw-border-none tw-bg-transparent tw-px-1 tw-py-2 tw-pr-8 tw-text-sm tw-text-normal tw-outline-none"
                aria-label="Quick Ask input"
              />
            }
            placeholder={
              <div className="tw-pointer-events-none tw-absolute tw-left-1 tw-top-2 tw-select-none tw-text-sm tw-text-muted/60">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <OnChangePlugin onChange={handleEditorChange} />
          <HistoryPlugin />
          <KeyboardPlugin onSubmit={onSubmit} sendShortcut={sendShortcut} />
          <ValueSyncPlugin value={value} />
          <FocusPlugin onFocus={handleFocusRegistration} onEditorReady={handleEditorReady} />
          <NotePillSyncPlugin onNotesChange={onNotesChange} onNotesRemoved={onNotesRemoved} />
          <FolderPillSyncPlugin
            onFoldersChange={onFoldersChange}
            onFoldersRemoved={onFoldersRemoved}
          />
          <ActiveNotePillSyncPlugin
            onActiveNoteAdded={onActiveNoteAdded}
            onActiveNoteRemoved={onActiveNoteRemoved}
          />
          <PillDeletionPlugin />
          <AtMentionCommandPlugin isCopilotPlus={false} currentActiveFile={currentActiveFile} />
        </div>
      </ActiveFileProvider>
    </LexicalComposer>
  );
});
