import { CheckIcon, CopyClipboardIcon, InsertIcon, RegenerateIcon } from "@/components/Icons";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import React from "react";

interface ChatButtonsProps {
  message: ChatMessage;
  onCopy: () => void;
  isCopied: boolean;
  onInsertAtCursor?: () => void;
  onRegenerate?: () => void;
}

export const ChatButtons: React.FC<ChatButtonsProps> = ({
  message,
  onCopy,
  isCopied,
  onInsertAtCursor,
  onRegenerate,
}) => {
  return (
    <div className="chat-message-buttons">
      <button onClick={onCopy} className="clickable-icon" title="Copy">
        {isCopied ? <CheckIcon /> : <CopyClipboardIcon />}
      </button>
      {message.sender === USER_SENDER ? (
        <button className="clickable-icon" title="Edit">
          {/* <EditIcon /> */}
        </button>
      ) : (
        <>
          <button
            onClick={onInsertAtCursor}
            className="clickable-icon"
            title="Insert to note at cursor"
          >
            <InsertIcon />
          </button>
          <button onClick={onRegenerate} className="clickable-icon" title="Regenerate">
            <RegenerateIcon />
          </button>
        </>
      )}
    </div>
  );
};
