import React, { createContext, useContext, useCallback, useState } from "react";
import { INSERT_TEXT_WITH_PILLS_COMMAND } from "@/components/chat-components/utils/lexicalTextUtils";
import { LexicalEditor } from "lexical";

interface ChatInputContextType {
  insertTextWithPills: (text: string, enableURLPills?: boolean) => void;
  focusInput: () => void;
  registerEditor: (editor: LexicalEditor) => void;
  registerFocusHandler: (handler: () => void) => void;
}

const ChatInputContext = createContext<ChatInputContextType | undefined>(undefined);

/**
 * Hook to access chat input functionality
 */
export function useChatInput(): ChatInputContextType {
  const context = useContext(ChatInputContext);
  if (context === undefined) {
    throw new Error("useChatInput must be used within a ChatInputProvider");
  }
  return context;
}

interface ChatInputProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that manages chat input functionality without requiring refs
 */
export function ChatInputProvider({ children }: ChatInputProviderProps): JSX.Element {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [focusHandler, setFocusHandler] = useState<(() => void) | null>(null);

  const registerEditor = useCallback((editorInstance: LexicalEditor) => {
    setEditor(editorInstance);
  }, []);

  const registerFocusHandler = useCallback((handler: () => void) => {
    setFocusHandler(() => handler);
  }, []);

  const insertTextWithPills = useCallback(
    (text: string, enableURLPills = false) => {
      if (editor) {
        editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
          text,
          options: { enableURLPills, insertAtSelection: true },
        });
      }
    },
    [editor]
  );

  const focusInput = useCallback(() => {
    if (focusHandler) {
      focusHandler();
    }
  }, [focusHandler]);

  const contextValue: ChatInputContextType = {
    insertTextWithPills,
    focusInput,
    registerEditor,
    registerFocusHandler,
  };

  return <ChatInputContext.Provider value={contextValue}>{children}</ChatInputContext.Provider>;
}
