import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

/**
 * Props for the FocusPlugin component
 */
interface FocusPluginProps {
  /** Callback that receives a function to programmatically focus the editor */
  onFocus: (focusFn: () => void) => void;
  /** Optional callback that receives the editor instance when ready */
  onEditorReady?: (editor: any) => void;
}

/**
 * Lexical plugin that provides focus management for the editor.
 * Exposes a focus function to parent components and optionally provides
 * access to the editor instance when it's ready.
 */
export function FocusPlugin({ onFocus, onEditorReady }: FocusPluginProps) {
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
