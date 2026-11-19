import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { Button } from "@/components/ui/button";
import { USER_SENDER } from "@/constants";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy } from "@/utils";
import {
  Copy,
  GitBranchPlus,
  LibraryBig,
  LucideIcon,
  MoreHorizontal,
  PenSquare,
  RotateCw,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { Menu, Platform } from "obsidian";
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

export interface MessageAction {
  label: string;
  icon: LucideIcon;
  menuIcon: string;
  onClick?: () => void;
  copyText?: string;
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
  const { copy } = useCopyToClipboard();
  const isUserMessage = message.sender === USER_SENDER;
  const copyText = cleanMessageForCopy(text);
  const copyAction: MessageAction = {
    label: "Copy",
    icon: Copy,
    menuIcon: "copy",
    onClick: () => copy(copyText),
    copyText,
  };
  const deleteAction: MessageAction | false = !!onDelete && {
    label: "Delete",
    icon: Trash2,
    menuIcon: "trash-2",
    onClick: onDelete,
  };
  const actions = (
    isUserMessage
      ? [
          copyAction,
          !!onEdit && { label: "Edit", icon: PenSquare, menuIcon: "square-pen", onClick: onEdit },
          deleteAction,
        ]
      : [
          hasSources && {
            label: "Show sources",
            icon: LibraryBig,
            menuIcon: "library-big",
            onClick: onShowSources,
          },
          {
            label: "Insert / Replace at cursor",
            icon: TextCursorInput,
            menuIcon: "text-cursor-input",
            onClick: onInsertIntoEditor,
          },
          copyAction,
          !!onContinue && {
            label: "Continue from here in a new chat",
            icon: GitBranchPlus,
            menuIcon: "git-branch-plus",
            onClick: onContinue,
          },
          !!onRegenerate && {
            label: "Regenerate",
            icon: RotateCw,
            menuIcon: "rotate-cw",
            onClick: onRegenerate,
          },
          deleteAction,
        ]
  ).filter((action): action is MessageAction => !!action);

  // One larger button on a phone, instead of a row of small ones a finger can miss, opens the actions as Obsidian's bottom sheet.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
  if (Platform.isMobile) {
    return (
      <MessageActionsMenuButton speaker={isUserMessage ? "You" : "Copilot"} actions={actions} />
    );
  }

  return (
    <div className="tw-flex tw-gap-1">
      {actions.map((action) =>
        action.copyText !== undefined ? (
          <CopyButton key={action.label} text={action.copyText} />
        ) : (
          <MessageActionButton
            key={action.label}
            label={action.label}
            icon={action.icon}
            onClick={action.onClick}
          />
        )
      )}
    </div>
  );
};

export interface MessageActionsMenuButtonProps {
  speaker: string;
  actions: MessageAction[];
}

export const MessageActionsMenuButton: React.FC<MessageActionsMenuButtonProps> = ({
  speaker,
  actions,
}) => {
  const openMenu = (event: React.MouseEvent) => {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(speaker).setIsLabel(true));
    for (const action of actions) {
      menu.addItem((item) =>
        item
          .setTitle(action.label)
          .setIcon(action.menuIcon)
          .onClick(() => action.onClick?.())
      );
    }
    menu.showAtMouseEvent(event.nativeEvent);
  };

  return (
    // A 44px box keeps the button easy to tap; the negative margins keep the row as tall as its glyph.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
    <Button
      variant="ghost2"
      size="fit"
      aria-label="Message actions"
      title="Message actions"
      onClick={openMenu}
      className="-tw-my-2.5 -tw-mr-2.5 tw-size-11"
    >
      <MoreHorizontal className="tw-size-4" />
    </Button>
  );
};
