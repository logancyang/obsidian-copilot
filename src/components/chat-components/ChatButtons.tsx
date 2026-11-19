import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy } from "@/utils";
import {
  GitBranchPlus,
  LibraryBig,
  PenSquare,
  RotateCw,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import React from "react";

interface ChatButtonsProps {
  message: ChatMessage;
  text: string;
  onInsertIntoEditor?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onShowSources?: () => void;
  onContinue?: () => void;
  hasSources: boolean;
}

export const ChatButtons: React.FC<ChatButtonsProps> = ({
  message,
  text,
  onInsertIntoEditor,
  onRegenerate,
  onEdit,
  onDelete,
  onShowSources,
  onContinue,
  hasSources,
}) => {
  return (
    <div className="tw-flex tw-gap-1">
      {message.sender === USER_SENDER ? (
        <>
          <CopyButton text={cleanMessageForCopy(text)} />
          {onEdit && <MessageActionButton label="Edit" icon={PenSquare} onClick={onEdit} />}
          {onDelete && <MessageActionButton label="Delete" icon={Trash2} onClick={onDelete} />}
        </>
      ) : (
        <>
          {hasSources && (
            <MessageActionButton label="Show sources" icon={LibraryBig} onClick={onShowSources} />
          )}
          <MessageActionButton
            label="Insert / Replace at cursor"
            icon={TextCursorInput}
            onClick={onInsertIntoEditor}
          />
          <CopyButton text={cleanMessageForCopy(text)} />
          {onContinue && (
            <MessageActionButton
              label="Continue from here in a new chat"
              icon={GitBranchPlus}
              onClick={onContinue}
            />
          )}
          {onRegenerate && (
            <MessageActionButton label="Regenerate" icon={RotateCw} onClick={onRegenerate} />
          )}
          {onDelete && <MessageActionButton label="Delete" icon={Trash2} onClick={onDelete} />}
        </>
      )}
    </div>
  );
};
