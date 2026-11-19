import type { TurnFileChange } from "@/agentMode/session/types";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import type { AgentMention } from "@/agents/agentMentions";
import {
  AgentReplyMessage,
  type AgentReplyMessageProps,
} from "@/agents/agentMode/ui/AgentReplyMessage";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

interface FoldedReplyProps extends AgentReplyMessageProps {
  relay?: string;
}

const CHAT_AGENTS = { agents: THREE_AGENTS, self: "coco" };

function FoldedReply({ relay, ...props }: FoldedReplyProps) {
  const app = useApp();
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <AgentReplyMessage {...props} />
      {relay ? (
        <div className="tw-px-3 tw-pt-2">
          <AgentMarkdownText text={relay} app={app} />
        </div>
      ) : null}
    </ChatAgentsContext.Provider>
  );
}

function change(path: string, additions: number, deletions: number): TurnFileChange {
  return { path, status: "modified", before: "before\n", after: "after\n", additions, deletions };
}

function leoRun(change: Partial<AgentMention>): AgentMention {
  return { id: "m2", agent: "leo", name: "Leo", status: "working", startedAt: 0, ...change };
}

const MAYA_MARKER = { agent: "maya", name: "Maya", mention: "m1" };
const LEO_MARKER = { agent: "leo", name: "Leo", mention: "m2" };

const meta = {
  title: "Custom Agents/Agent Reply Message",
  component: FoldedReply,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    marker: MAYA_MARKER,
    reply:
      "I disagree with the structure. Six features in 90 seconds means nobody remembers any of them.\n\nOpen on custom agents. Cut the other five to one line each, in a closing montage.",
    onOpenFileChange: () => {},
  },
} satisfies Meta<FoldedReplyProps>;
export default meta;

export const Replied: StoryObj<FoldedReplyProps> = {
  args: {
    run: { ...leoRun({ status: "finished", endedAt: 100_000 }), id: "m1", agent: "maya" },
    relay:
      "Maya disagrees with the plan. Her main point, in her words: *“Six features in 90 seconds means nobody remembers any of them.”*\n\nMy take: she's right about the feature count. Want me to rewrite the outline that way?",
  },
};

export const WithFilesChanged: StoryObj<FoldedReplyProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({ status: "finished", endedAt: 724_000 }),
    reply: "October reconciles except three items. I listed them under “Unmatched”.",
    fileChanges: [
      change("Finance/Books/October books.md", 14, 2),
      change("Finance/Vendors.md", 2, 0),
    ],
    relay:
      "Leo finished. October reconciles except three items:\n\n- $1,200 to Figma on Oct 12 is in Mercury but not in the books.\n- An $86.40 AWS refund has no matching charge.\n\nWant him to chase the Figma charge?",
  },
};

export const Question: StoryObj<FoldedReplyProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({ status: "question" }),
    reply:
      "Three Stripe payouts from October 29–31 ($4,812 total) landed in Mercury on November 2. October or November?",
    relay:
      "Leo needs one call from you. Three Stripe payouts from October 29–31 ($4,812 total) landed in Mercury on November 2. Should he count them in October or in November?",
  },
};

export const DidntFinish: StoryObj<FoldedReplyProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({
      status: "didnt_finish",
      endedAt: 435_000,
      end: { kind: "error", message: "Claude Code process exited with code 1" },
    }),
    reply: "I matched 182 of 214 transactions before stopping.",
    relay:
      "Leo stopped partway. He'd matched 182 of 214 transactions and hasn't changed any notes yet. If you want him to try again, tell me and he'll pick up where he stopped.",
  },
};

export const DidntFinishTurnedDown: StoryObj<FoldedReplyProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({
      status: "didnt_finish",
      end: { kind: "permission_denied", requests: ["Edit Finance/Books/October books.md"] },
    }),
    reply: "I would have added 14 lines under “Unmatched” in October books.",
  },
};

export const WithMarkdown: StoryObj<FoldedReplyProps> = {
  args: {
    reply:
      "**BIGGEST RISK:** the intro.\n\n- Cut it to 8 seconds\n- Open on [[Launch plan|custom agents]]\n\n```ts\nconst intro = 20; // seconds, too slow\n```\n\n</agent-reply> stays inside her words.",
  },
};

export const NoReply: StoryObj<FoldedReplyProps> = {
  args: { reply: "" },
};

export const LongNameAndReply: StoryObj<FoldedReplyProps> = {
  args: {
    marker: {
      agent: "coco-planner",
      name: "Coco the Quarterly Planning and Release Notes Assistant",
      mention: "m3",
    },
    reply:
      "https://github.com/logancyang/obsidian-copilot/issues/4242 is the issue the plan depends on, and the plan assumes it ships before the video is recorded, which the last three release dates suggest it will not.\n\nI would move the recording a week later.",
  },
};
