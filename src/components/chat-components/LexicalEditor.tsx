import React, { useCallback, useEffect } from "react";
import { $getRoot, EditorState, LexicalEditor as LexicalEditorType } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import { NoteCommandPlugin } from "./NoteCommandPlugin";
import { NotePillPlugin, NotePillNode } from "./NotePillPlugin";
import { URLPillPlugin, URLPillNode } from "./URLPillNode";
import { PillDeletionPlugin } from "./PillDeletionPlugin";
import { KeyboardPlugin } from "./plugins/KeyboardPlugin";
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin";
import { FocusPlugin } from "./plugins/FocusPlugin";
import { NotePillSyncPlugin } from "./plugins/NotePillSyncPlugin";
import { URLPillSyncPlugin } from "./plugins/URLPillSyncPlugin";
import { PastePlugin } from "./plugins/PastePlugin";
import { TextInsertionPlugin } from "./plugins/TextInsertionPlugin";
import { useChatInput } from "@/context/ChatInputContext";
import { cn } from "@/lib/utils";

interface LexicalEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
  onURLsChange?: (urls: string[]) => void;
  onURLsRemoved?: (removedUrls: string[]) => void;
  onEditorReady?: (editor: any) => void;
}

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  disabled = false,
  className = "",
  onNotesChange,
  onNotesRemoved,
  onURLsChange,
  onURLsRemoved,
  onEditorReady,
}) => {
  const [focusFn, setFocusFn] = React.useState<(() => void) | null>(null);
  const [editorInstance, setEditorInstance] = React.useState<LexicalEditorType | null>(null);
  const chatInputContext = useChatInput();

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
      nodes: [NotePillNode, ...(onURLsChange ? [URLPillNode] : [])],
      onError: (error: Error) => {
        console.error("Lexical error:", error);
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

  const handleEditorReady = useCallback(
    (editor: LexicalEditorType) => {
      setEditorInstance(editor);
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn("tw-relative", className)}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="tw-max-h-40 tw-min-h-[60px] tw-w-full tw-resize-none tw-overflow-y-auto tw-rounded-md tw-border-none tw-bg-transparent tw-px-2 tw-text-sm tw-text-normal tw-outline-none focus-visible:tw-ring-0"
              aria-label="Chat input"
            />
          }
          placeholder={
            <div className="tw-pointer-events-none tw-absolute tw-left-2 tw-top-0 tw-select-none tw-text-sm tw-text-muted/60">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={handleEditorChange} />
        <HistoryPlugin />
        <KeyboardPlugin onSubmit={onSubmit} />
        <ValueSyncPlugin value={value} />
        <FocusPlugin onFocus={setFocusFn} onEditorReady={handleEditorReady} />
        <NotePillSyncPlugin onNotesChange={onNotesChange} onNotesRemoved={onNotesRemoved} />
        {onURLsChange && (
          <URLPillSyncPlugin onURLsChange={onURLsChange} onURLsRemoved={onURLsRemoved} />
        )}
        <PillDeletionPlugin />
        <PastePlugin enableURLPills={!!onURLsChange} />
        <SlashCommandPlugin />
        <NoteCommandPlugin />
        <NotePillPlugin />
        {onURLsChange && <URLPillPlugin />}
        <TextInsertionPlugin />
      </div>
    </LexicalComposer>
  );
};

export default LexicalEditor;
