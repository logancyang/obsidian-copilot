import {
  MessageActionsMenuButton,
  type MessageAction,
  type MessageActionsMenuButtonProps,
} from "./ChatButtons";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import type { Meta, StoryObj } from "@/lib/story";
import { Copy, PenSquare, RotateCw, TextCursorInput, Trash2 } from "lucide-react";
import React from "react";

const SENT_AT = new Date(2026, 10, 18, 14, 9, 41).getTime();
const inert = () => undefined;

const USER_ACTIONS: MessageAction[] = [
  { label: "Copy", icon: Copy, menuIcon: "copy", onClick: inert },
  { label: "Edit", icon: PenSquare, menuIcon: "square-pen", onClick: inert },
  { label: "Delete", icon: Trash2, menuIcon: "trash-2", onClick: inert },
];

const REPLY_ACTIONS: MessageAction[] = [
  {
    label: "Insert / Replace at cursor",
    icon: TextCursorInput,
    menuIcon: "text-cursor-input",
    onClick: inert,
  },
  { label: "Copy", icon: Copy, menuIcon: "copy", onClick: inert },
  { label: "Regenerate", icon: RotateCw, menuIcon: "rotate-cw", onClick: inert },
  { label: "Delete", icon: Trash2, menuIcon: "trash-2", onClick: inert },
];

const PhoneMessage: React.FC<MessageActionsMenuButtonProps> = (props) => (
  <div className="tw-flex tw-flex-col tw-gap-1">
    <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-modifier-hover tw-p-2 tw-text-sm">
      {props.speaker === "You"
        ? "Which one is shortest?"
        : "The Order of Time, at about 240 pages."}
    </div>
    <div className="tw-px-2">
      <AssistantResponseFooter
        timestampMs={SENT_AT}
        shownAtRest
        actions={<MessageActionsMenuButton {...props} />}
      />
    </div>
  </div>
);

const meta = {
  title: "Chat/Phone Message Actions",
  component: PhoneMessage,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MessageActionsMenuButtonProps>;
export default meta;

export const YourMessage: StoryObj<MessageActionsMenuButtonProps> = {
  args: { speaker: "You", actions: USER_ACTIONS },
};

export const Reply: StoryObj<MessageActionsMenuButtonProps> = {
  args: { speaker: "Copilot", actions: REPLY_ACTIONS },
};
