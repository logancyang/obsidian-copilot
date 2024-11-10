import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { Check, Copy, MessageSquarePlus, PenSquare, RotateCw, Trash2 } from "lucide-react";
import React from "react";

interface ChatButtonsProps {
  message: ChatMessage;
  onCopy: () => void;
  isCopied: boolean;
  onInsertAtCursor?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}

export const ChatButtons: React.FC<ChatButtonsProps> = ({
  message,
  onCopy,
  isCopied,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
  onDelete,
}) => {
  return (
    <div className="chat-message-buttons">
      <button onClick={onCopy} className="clickable-icon" title="Copy">
        {isCopied ? <Check /> : <Copy />}
      </button>
      {message.sender === USER_SENDER ? (
        <>
          <button onClick={onEdit} className="clickable-icon" title="Edit">
            <PenSquare />
          </button>
          <button onClick={onDelete} className="clickable-icon" title="Delete">
            <Trash2 />
          </button>
        </>
      ) : (
        <>
          <button
            onClick={onInsertAtCursor}
            className="clickable-icon"
            title="Insert to note at cursor"
          >
            <MessageSquarePlus />
          </button>
          <button onClick={onRegenerate} className="clickable-icon" title="Regenerate">
            <RotateCw />
          </button>
          <button onClick={onDelete} className="clickable-icon" title="Delete">
            <Trash2 />
          </button>
        </>
      )}
    </div>
  );
};
