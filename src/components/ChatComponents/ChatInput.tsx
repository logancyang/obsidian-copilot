import { ListPromptModal } from "@/components/ListPromptModal";
import { NoteTitleModal } from "@/components/NoteTitleModal";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { CopilotSettings } from "@/settings/SettingsPage";
import { IconPlayerStopFilled, IconSend } from "@tabler/icons-react";
import { App, TFile } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSendMessage: () => void;
  getChatVisibility: () => Promise<boolean>;
  isGenerating: boolean;
  onStopGenerating: () => void;
  app: App;
  settings: CopilotSettings;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputMessage,
  setInputMessage,
  handleKeyDown,
  handleSendMessage,
  getChatVisibility,
  isGenerating,
  onStopGenerating,
  app,
  settings,
}) => {
  const [rows, setRows] = useState(1);
  const [shouldFocus, setShouldFocus] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleInputChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = event.target.value;
    setInputMessage(inputValue);
    updateRows(inputValue);

    if (inputValue.slice(-2) === "[[") {
      showNoteTitleModal();
    } else if (inputValue === "/") {
      showCustomPromptModal();
    }
  };

  const showNoteTitleModal = () => {
    const fetchNoteTitles = async () => {
      const noteTitles = app.vault.getMarkdownFiles().map((file: TFile) => file.basename);

      new NoteTitleModal(app, noteTitles, (noteTitle: string) => {
        setInputMessage(inputMessage.slice(0, -2) + ` [[${noteTitle}]]`);
      }).open();
    };

    fetchNoteTitles();
  };

  const showCustomPromptModal = async () => {
    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
    const prompts = await customPromptProcessor.getAllPrompts();
    const promptTitles = prompts.map((prompt) => prompt.title);

    new ListPromptModal(app, promptTitles, async (promptTitle: string) => {
      const selectedPrompt = prompts.find((prompt) => prompt.title === promptTitle);
      if (selectedPrompt) {
        setInputMessage(selectedPrompt.content);
        updateRows(selectedPrompt.content);
      }
    }).open();
  };

  const updateRows = (text: string) => {
    const lineHeight = 20;
    const maxHeight = 200;
    const minRows = 1;

    const rowsNeeded = Math.min(
      Math.max(text.split("\n").length, minRows),
      Math.floor(maxHeight / lineHeight)
    );
    setRows(rowsNeeded);
  };

  // Effect hook to get the chat visibility
  useEffect(() => {
    const fetchChatVisibility = async () => {
      const visibility = await getChatVisibility();
      setShouldFocus(visibility);
    };
    fetchChatVisibility();
  }, [getChatVisibility]);

  // This effect will run every time the shouldFocus state is updated
  useEffect(() => {
    if (textAreaRef.current && shouldFocus) {
      textAreaRef.current.focus();
    }
  }, [shouldFocus]);

  return (
    <div className="chat-input-container">
      <textarea
        ref={textAreaRef}
        className="chat-input-textarea"
        placeholder="Ask anything. [[ for notes. / for custom prompts."
        value={inputMessage}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        rows={rows}
      />
      <button
        onClick={isGenerating ? onStopGenerating : handleSendMessage}
        aria-label={isGenerating ? "Stop generating" : "Send message"}
      >
        {isGenerating ? <IconPlayerStopFilled size={18} /> : <IconSend size={18} />}
      </button>
    </div>
  );
};

export default ChatInput;
