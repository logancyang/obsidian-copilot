import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { INSERT_TEXT_WITH_PILLS_COMMAND } from "@/components/chat-components/utils/lexicalTextUtils";
import { LexicalEditor } from "lexical";

interface ChatInputContextType {
  insertTextWithPills: (text: string, enableURLPills?: boolean) => void;
  focusInput: () => void;
  registerEditor: (editor: LexicalEditor) => void;
  registerFocusHandler: (handler: (() => void) | null) => void;
}

const ChatInputContext = createContext<ChatInputContextType | undefined>(undefined);

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

export function ChatInputProvider({ children }: ChatInputProviderProps): JSX.Element {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const focusHandlerRef = useRef<(() => void) | null>(null);
  const pendingInsertRef = useRef<{ text: string; enableURLPills: boolean } | null>(null);
  const pendingFocusRef = useRef(false);

  const registerEditor = useCallback((editorInstance: LexicalEditor) => {
    setEditor(editorInstance);
  }, []);

  // The handler is read from a ref so a request made after its composer unmounted waits for the next one.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/803
  const registerFocusHandler = useCallback((handler: (() => void) | null) => {
    focusHandlerRef.current = handler;
    if (handler && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      handler();
    }
  }, []);

  const insertTextWithPills = useCallback(
    (text: string, enableURLPills = false) => {
      if (editor) {
        editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
          text,
          options: { enableURLPills },
        });
      } else {
        pendingInsertRef.current = { text, enableURLPills };
      }
    },
    [editor]
  );

  useEffect(() => {
    if (!editor || !pendingInsertRef.current) return;
    const { text, enableURLPills } = pendingInsertRef.current;
    pendingInsertRef.current = null;
    editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
      text,
      options: { enableURLPills },
    });
  }, [editor]);

  const focusInput = useCallback(() => {
    if (focusHandlerRef.current) {
      focusHandlerRef.current();
    } else {
      pendingFocusRef.current = true;
    }
  }, []);

  const contextValue = useMemo<ChatInputContextType>(
    () => ({
      insertTextWithPills,
      focusInput,
      registerEditor,
      registerFocusHandler,
    }),
    [insertTextWithPills, focusInput, registerEditor, registerFocusHandler]
  );

  return <ChatInputContext.Provider value={contextValue}>{children}</ChatInputContext.Provider>;
}
