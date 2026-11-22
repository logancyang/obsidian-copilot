import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

interface FocusPluginProps {
  onFocus: (focusFn: () => void) => void;
  onEditorReady?: (editor: LexicalEditor) => void;
}

export function FocusPlugin({ onFocus, onEditorReady }: FocusPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const focusEditor = () => {
      editor.focus();
    };
    onFocus(focusEditor);

    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onFocus, onEditorReady]);

  return null;
}
