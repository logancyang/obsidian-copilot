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

export const CommandScopes: StoryObj<ToolPermissionCardProps> = {
  args: {
    request: {
      ...request,
      toolCall: {
        ...request.toolCall,
        title: "Run project validation",
        kind: "execute",
        rawInput: { command: "npm run validate" },
      },
      options: [
        { optionId: "once", name: "Allow once", kind: "allow_once" },
        { optionId: "no", name: "Deny once", kind: "reject_once" },
        {
          optionId: "session",
          name: "Allow for Session",
          kind: "allow_always",
          description: "Allow this command for the current session.",
        },
        {
          optionId: "accept_execpolicy_amendment",
          name: "Always allow",
          kind: "allow_always",
          description: "Allow commands starting with npm run validate.",
        },
        {
          optionId: "network:0",
          name: "Always allow",
          kind: "allow_always",
          description: "Allow network access to registry.npmjs.org.",
        },
      ],
    },
  },
};

export const MultipleFiles: StoryObj<ToolPermissionCardProps> = {
  args: {
    request: {
      ...request,
      toolCall: {
        ...request.toolCall,
        title: "Update the launch brief and project roadmap",
        kind: "edit",
        content: [
          {
            type: "diff",
            path: "Projects/Launch brief.md",
            oldText: "Draft review",
            newText: "Review the launch brief on Friday.",
          },
          {
            type: "diff",
            path: "Projects/Roadmap.md",
            oldText: "Launch planning",
            newText: "Schedule the launch review.",
          },
        ],
      },
    },
  },
};

export const LongLabels: StoryObj<ToolPermissionCardProps> = {
  args: {
    request: {
      ...request,
      options: [
        { optionId: "once", name: "Allow this request one time", kind: "allow_once" },
        { optionId: "no", name: "Decline this permission request", kind: "reject_once" },
        {
          optionId: "always",
          name: "Allow future requests matching this command",
          kind: "allow_always",
          description:
            "Allow commands starting with npm run validate -- --project=launch-readiness.",
        },
      ],
    },
  },
};
