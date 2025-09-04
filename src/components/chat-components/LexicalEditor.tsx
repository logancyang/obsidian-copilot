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
import { cn } from "@/lib/utils";

interface LexicalEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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

// Plugin to provide focus method
function FocusPlugin({ onFocus }: { onFocus: (focusFn: () => void) => void }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const focusEditor = () => {
      editor.focus();
    };
    onFocus(focusEditor);
  }, [editor, onFocus]);

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
          <FocusPlugin onFocus={setFocusFn} />
          <SlashCommandPlugin />
        </div>
      </LexicalComposer>
    );
  }
);

LexicalEditor.displayName = "LexicalEditor";

export default LexicalEditor;
