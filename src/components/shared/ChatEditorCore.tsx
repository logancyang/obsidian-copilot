import React, { useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  EditorState,
  LexicalEditor as LexicalEditorType,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";

/**
 * Props for the ChatEditorCore component
 * A minimal, reusable Lexical editor component for chat inputs
 */
export interface ChatEditorCoreProps {
  /** Callback triggered when the user submits (Enter key by default) */
  onSubmit: (text: string) => void;

  /** Placeholder text shown when editor is empty */
  placeholder?: string;

  /** Whether the editor is disabled */
  disabled?: boolean;

  /** Initial content to populate the editor with */
  initialContent?: string;

  /** Additional CSS classes */
  className?: string;

  /** Send shortcut configuration - defaults to Enter */
  sendShortcut?: "enter" | "shift+enter";
}

/**
 * Ref interface for ChatEditorCore
 * Provides imperative methods for controlling the editor
 */
export interface ChatEditorCoreRef {
  /** Insert text at the current cursor position or replace selection */
  insertText: (text: string) => void;

  /** Clear all content from the editor */
  clear: () => void;

  /** Focus the editor */
  focus: () => void;

  /** Get the current text content of the editor */
  getText: () => string;
}

/**
 * Internal plugin for keyboard handling
 */
function KeyboardSubmitPlugin({
  onSubmit,
  sendShortcut,
}: {
  onSubmit: () => void;
  sendShortcut: "enter" | "shift+enter";
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        // Ignore Enter key during IME composition
        if (event.isComposing) {
          return false;
        }

        const shouldSubmit =
          sendShortcut === "enter"
            ? !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
            : event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

        if (shouldSubmit) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onSubmit, sendShortcut]);

  return null;
}

/**
 * Internal plugin for syncing external value with editor content
 */
function ValueSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
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

/**
 * Internal plugin to expose editor instance
 */
function EditorRefPlugin({
  editorRef,
}: {
  editorRef: React.MutableRefObject<LexicalEditorType | null>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);

  return null;
}

/**
 * ChatEditorCore - A reusable Lexical editor component for chat inputs
 *
 * This component provides a minimal, focused editor that can be used
 * in various chat contexts (main Copilot chat, Projects+ Discuss, etc.)
 * without the complexity of the full ChatInput component.
 *
 * @example
 * ```tsx
 * const editorRef = useRef<ChatEditorCoreRef>(null);
 *
 * <ChatEditorCore
 *   ref={editorRef}
 *   onSubmit={(text) => handleSend(text)}
 *   placeholder="Type a message..."
 * />
 * ```
 */
export const ChatEditorCore = forwardRef<ChatEditorCoreRef, ChatEditorCoreProps>(
  (
    {
      onSubmit,
      placeholder = "Type a message...",
      disabled = false,
      initialContent = "",
      className = "",
      sendShortcut = "enter",
    },
    ref
  ) => {
    const editorInstanceRef = React.useRef<LexicalEditorType | null>(null);
    const [value, setValue] = React.useState(initialContent);

    // Sync initialContent changes
    useEffect(() => {
      setValue(initialContent);
    }, [initialContent]);

    const initialConfig = React.useMemo(
      () => ({
        namespace: "ChatEditorCore",
        theme: {
          root: "tw-outline-none",
          paragraph: "tw-m-0",
        },
        nodes: [],
        onError: (error: Error) => {
          logError("ChatEditorCore Lexical error:", error);
        },
        editable: !disabled,
      }),
      [disabled]
    );

    const handleEditorChange = useCallback((editorState: EditorState) => {
      editorState.read(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();
        setValue(textContent);
      });
    }, []);

    const handleSubmit = useCallback(() => {
      const text = value.trim();
      if (text) {
        onSubmit(text);
      }
    }, [value, onSubmit]);

    // Expose imperative methods via ref
    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          const editor = editorInstanceRef.current;
          if (!editor) return;

          editor.update(() => {
            const root = $getRoot();
            const currentText = root.getTextContent();
            root.clear();
            root.append($createParagraphNode().append($createTextNode(currentText + text)));
          });
        },

        clear: () => {
          const editor = editorInstanceRef.current;
          if (!editor) return;

          editor.update(() => {
            const root = $getRoot();
            root.clear();
          });
          setValue("");
        },

        focus: () => {
          const editor = editorInstanceRef.current;
          if (editor) {
            editor.focus();
          }
        },

        getText: () => {
          return value;
        },
      }),
      [value]
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
          <KeyboardSubmitPlugin onSubmit={handleSubmit} sendShortcut={sendShortcut} />
          <ValueSyncPlugin value={value} />
          <EditorRefPlugin editorRef={editorInstanceRef} />
        </div>
      </LexicalComposer>
    );
  }
);

ChatEditorCore.displayName = "ChatEditorCore";

export default ChatEditorCore;
