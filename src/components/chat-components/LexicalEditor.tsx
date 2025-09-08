import React, { forwardRef, useCallback, useImperativeHandle } from "react";
import { $getRoot, EditorState } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import { NoteCommandPlugin } from "./NoteCommandPlugin";
import { NotePillPlugin, NotePillNode } from "./NotePillPlugin";
import { PillDeletionPlugin } from "./PillDeletionPlugin";
import { KeyboardPlugin } from "./plugins/KeyboardPlugin";
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin";
import { FocusPlugin } from "./plugins/FocusPlugin";
import { NotePillSyncPlugin } from "./plugins/NotePillSyncPlugin";
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
  onEditorReady?: (editor: any) => void;
}

const LexicalEditor = forwardRef<{ focus: () => void }, LexicalEditorProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      placeholder = "Type a message...",
      disabled = false,
      className = "",
      onNotesChange,
      onNotesRemoved,
      onEditorReady,
    },
    ref
  ) => {
    const [focusFn, setFocusFn] = React.useState<(() => void) | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        focusFn?.();
      },
    }));

    const initialConfig = {
      namespace: "ChatEditor",
      theme: {
        root: "tw-outline-none",
        paragraph: "tw-m-0",
      },
      nodes: [NotePillNode],
      onError: (error: Error) => {
        console.error("Lexical error:", error);
      },
      editable: !disabled,
    };

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
          <FocusPlugin onFocus={setFocusFn} onEditorReady={onEditorReady} />
          <NotePillSyncPlugin onNotesChange={onNotesChange} onNotesRemoved={onNotesRemoved} />
          <PillDeletionPlugin />
          <SlashCommandPlugin />
          <NoteCommandPlugin />
          <NotePillPlugin />
        </div>
      </LexicalComposer>
    );
  }
);

LexicalEditor.displayName = "LexicalEditor";

export default LexicalEditor;
