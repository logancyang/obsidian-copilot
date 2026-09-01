import type { PermissionPrompt, SessionId } from "@/agentMode/session/types";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type ToolPermissionCardProps = React.ComponentProps<typeof ToolPermissionCard>;

const request = {
  sessionId: "gallery-session" as SessionId,
  toolCall: {
    toolCallId: "gallery-permission",
    status: "pending",
    title: "Edit launch brief.md",
  },
  options: [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
  ],
} satisfies PermissionPrompt;

const meta = {
  title: "Agent Mode/Tool Permission Card",
  component: ToolPermissionCard,
  args: {
    request,
    onResolve: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ToolPermissionCardProps>;
export default meta;

/** The action footer has one top divider inside the card's outer border. */
export const Default: StoryObj<ToolPermissionCardProps> = {};
