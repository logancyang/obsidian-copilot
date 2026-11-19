import type { TurnFileChange } from "@/agentMode/session/types";
import {
  AgentReplyMessage,
  type AgentReplyMessageProps,
} from "@/agents/agentMode/ui/AgentReplyMessage";
import type { Meta, StoryObj } from "@/lib/story";

function change(path: string, additions: number, deletions: number): TurnFileChange {
  return { path, status: "modified", before: "before\n", after: "after\n", additions, deletions };
}

const meta = {
  title: "Custom Agents/Agent Reply Message",
  component: AgentReplyMessage,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    mention: "mention-1",
    name: "Maya",
    reply:
      "BIGGEST RISK: Six features in 90 seconds means nobody remembers any of them.\nOpen on custom agents and cut the other five to one line each.",
    onOpenFileChange: () => {},
  },
} satisfies Meta<AgentReplyMessageProps>;
export default meta;

export const Replied: StoryObj<AgentReplyMessageProps> = {};

export const WithFilesChanged: StoryObj<AgentReplyMessageProps> = {
  args: {
    name: "Leo",
    reply: "October reconciles except three items. I listed them under “Unmatched”.",
    fileChanges: [
      change("Finance/Books/October books.md", 14, 2),
      change("Finance/Vendors.md", 2, 0),
    ],
  },
};

export const WithMarkdown: StoryObj<AgentReplyMessageProps> = {
  args: {
    reply:
      "**BIGGEST RISK:** the intro.\n\n- Cut it to 8 seconds\n- Open on [[Launch plan|custom agents]]\n\n```ts\nconst intro = 20; // seconds, too slow\n```",
  },
};

export const NoReply: StoryObj<AgentReplyMessageProps> = {
  args: { reply: "" },
};

export const LongNameAndReply: StoryObj<AgentReplyMessageProps> = {
  args: {
    name: "Coco the Quarterly Planning and Release Notes Assistant",
    reply:
      "https://github.com/logancyang/obsidian-copilot/issues/4242 is the issue the plan depends on, and the plan assumes it ships before the video is recorded, which the last three release dates suggest it will not.\n\nI would move the recording a week later.",
  },
};
