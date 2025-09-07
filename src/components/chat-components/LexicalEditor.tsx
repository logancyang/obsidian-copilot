import React, { forwardRef, useImperativeHandle } from "react";
import { $getRoot, EditorState, $createParagraphNode, $createTextNode } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { KEY_ENTER_COMMAND } from "lexical";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import { NoteCommandPlugin } from "./NoteCommandPlugin";
import { NotePillPlugin, NotePillNode, $isNotePillNode } from "./NotePillPlugin";
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

// Custom plugin to handle keyboard events
function KeyboardPlugin({ onSubmit }: { onSubmit: () => void }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.shiftKey) {
          // Allow line break on Shift+Enter
          return false;
        }

        event.preventDefault();
        onSubmit();
        return true;
      },
      1 // High priority
    );
  }, [editor, onSubmit]);

  return null;
}

// Plugin to sync external value changes with editor
function ValueSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    editor.update(() => {
      const root = $getRoot();
      const currentText = root.getTextContent();

      if (currentText !== value) {
        root.clear();
        if (value) {
          root.append($createParagraphNode().append($createTextNode(value)));
        }
      }
    });
  }, [editor, value]);

  return null;
}

// Plugin to provide focus method and editor instance
function FocusPlugin({
  onFocus,
  onEditorReady,
}: {
  onFocus: (focusFn: () => void) => void;
  onEditorReady?: (editor: any) => void;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const focusEditor = () => {
      editor.focus();
    };
    onFocus(focusEditor);

    // Also provide the editor instance
    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onFocus, onEditorReady]);

  return null;
}

// Plugin to track pill changes and notify parent
function NotePillSyncPlugin({
  onNotesChange,
  onNotesRemoved,
}: {
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
}) {
  const [editor] = useLexicalComposerContext();

  // Track pill changes and notify parent
  React.useEffect(() => {
    if (!onNotesChange && !onNotesRemoved) return;

    const prevNotesRef = { current: [] as { path: string; basename: string }[] };

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const notes: { path: string; basename: string }[] = [];
        const root = $getRoot();

        function traverse(node: any) {
          if ($isNotePillNode(node)) {
            notes.push({
              path: node.getNotePath(),
              basename: node.getNoteTitle(),
            });
          }

          // Only traverse children if the node has the getChildren method
          if (typeof node.getChildren === "function") {
            const children = node.getChildren();
            for (const child of children) {
              traverse(child);
            }
          }
        }

        traverse(root);

        // Check for changes
        const prevNotes = prevNotesRef.current;
        const currentPaths = notes.map((note) => note.path).sort();
        const prevPaths = prevNotes.map((note) => note.path).sort();

        if (JSON.stringify(prevPaths) !== JSON.stringify(currentPaths)) {
          // Detect removed notes
          if (onNotesRemoved) {
            const currentPathSet = new Set(currentPaths);
            const removedNotes = prevNotes.filter((note) => !currentPathSet.has(note.path));

            if (removedNotes.length > 0) {
              onNotesRemoved(removedNotes);
            }
          }

          // Update current notes
          prevNotesRef.current = notes;
          if (onNotesChange) {
            onNotesChange(notes);
          }
        }
      });
    });
  }, [editor, onNotesChange, onNotesRemoved]);

  return null;
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

    const handleEditorChange = (editorState: EditorState) => {
      editorState.read(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();
        onChange(textContent);
      });
    };

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
