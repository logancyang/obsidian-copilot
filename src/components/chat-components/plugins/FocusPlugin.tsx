import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

interface FocusPluginProps {
  onFocus: (focusFn: () => void) => void;
  onEditorReady?: (editor: any) => void;
}

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
