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

export const Default: StoryObj<ToolPermissionCardProps> = {};

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

export const WebSearchQuery: StoryObj<ToolPermissionCardProps> = {
  args: {
    toolName: "websearch",
    request: {
      ...request,
      toolCall: {
        ...request.toolCall,
        title: "latest stable version of Node.js 2026",
        kind: "other",
        rawInput: { query: "latest stable version of Node.js 2026" },
      },
    },
  },
};

const codexCommand =
  'python3 -c \'from pathlib import Path; p = Path("/Users/me/Vault/launch-brief.md"); p.write_text("Review on Friday")\'';

export const CodexCommandPrefix: StoryObj<ToolPermissionCardProps> = {
  args: {
    toolName: codexCommand,
    request: {
      ...request,
      toolCall: {
        ...request.toolCall,
        title: "Run command",
        kind: "execute",
        rawInput: { command: codexCommand },
      },
      options: [
        { optionId: "approved", name: "Yes, proceed", kind: "allow_once" },
        {
          optionId: "approved-execpolicy-amendment",
          name: `Yes, and don't ask again for commands that start with \`${codexCommand}\``,
          kind: "allow_always",
        },
        {
          optionId: "abort",
          name: "No, and tell Codex what to do differently",
          kind: "reject_once",
        },
      ],
    },
  },
};
