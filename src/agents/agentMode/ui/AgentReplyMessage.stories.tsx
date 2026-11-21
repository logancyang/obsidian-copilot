import type { TurnFileChange } from "@/agentMode/session/types";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import type { AgentMention } from "@/agents/agentMentions";
import {
  AgentReplyMessage,
  type AgentReplyMessageProps,
} from "@/agents/agentMode/ui/AgentReplyMessage";
import { MemorySaveLine } from "@/agents/agentMode/ui/MemorySaveLine";
import { ChatAgentsContext, ChatRunsContext } from "@/agents/ui/chatAgents";
import type { MemorySave } from "@/agents/memorySaves";
import { LONG_NAMED_AGENT, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

interface ReplyCardProps extends AgentReplyMessageProps {
  relay?: string;
  saves?: MemorySave[];
}

const CHAT_AGENTS = {
  agents: [...THREE_AGENTS, LONG_NAMED_AGENT],
  self: "coco",
  openRun: () => {},
};

const RUN_FOUND = () => true;
const RUN_NOT_FOUND = () => false;

function ReplyCard({ relay, saves, ...props }: ReplyCardProps) {
  const app = useApp();
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <ChatRunsContext.Provider value={props.run ? RUN_FOUND : RUN_NOT_FOUND}>
        <AgentReplyMessage {...props}>
          {saves?.map((save) => (
            <MemorySaveLine
              key={save.rule}
              {...save}
              onOpen={() => {}}
              onOpenInstruction={() => {}}
            />
          ))}
        </AgentReplyMessage>
      </ChatRunsContext.Provider>
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
const MAYA_MEMORY = "copilot/teammates/maya/MEMORY.md";
const LEO_MARKER = { agent: "leo", name: "Leo", mention: "m2" };

const meta = {
  title: "Copilot Teammates/Agent Reply Message",
  component: ReplyCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    marker: MAYA_MARKER,
    reply: "Six features in 90 seconds means nobody remembers any of them.",
    onOpenFileChange: () => {},
  },
} satisfies Meta<ReplyCardProps>;
export default meta;

export const MessageFrom: StoryObj<ReplyCardProps> = {
  args: {
    run: { ...leoRun({ status: "finished" }), id: "m1", agent: "maya" },
    relay:
      "Maya disagrees with the plan. Her main point, in her words: *“Six features in 90 seconds means nobody remembers any of them.”*\n\nMy take: she's right about the feature count. Want me to rewrite the outline that way?",
  },
};

export const RememberedARule: StoryObj<ReplyCardProps> = {
  args: {
    run: { ...leoRun({ status: "finished" }), id: "m1", agent: "maya" },
    reply: "This cut runs 94 seconds, 4 over the target.",
    saves: [
      {
        agentName: "Maya",
        memoryPath: MAYA_MEMORY,
        rule: "Flag video length before anything else.",
      },
    ],
    fileChanges: [change("Plans/Launch video.md", 1, 0)],
    relay: "Maya says this cut runs 94 seconds, 4 over the target.",
  },
};

export const ReplacedARule: StoryObj<ReplyCardProps> = {
  args: {
    run: { ...leoRun({ status: "finished" }), id: "m1", agent: "maya" },
    reply: "Budget first from now on. This plan's $8k holds if the ads stay under $3k.",
    saves: [
      {
        agentName: "Maya",
        memoryPath: MAYA_MEMORY,
        rule: "Flag the budget before anything else.",
        replaced: "Flag video length before anything else.",
      },
    ],
    relay: "Maya will lead with the budget now. On this plan: $8k holds if ads stay under $3k.",
  },
};

export const WithFilesChanged: StoryObj<ReplyCardProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({ status: "finished" }),
    reply: "October reconciles except three items. I listed them under “Unmatched”.",
    fileChanges: [
      change("Finance/Books/October books.md", 14, 2),
      change("Finance/Vendors.md", 2, 0),
    ],
    relay:
      "Leo finished. October reconciles except three items. Want him to chase the Figma charge?",
  },
};

export const Question: StoryObj<ReplyCardProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({ status: "question" }),
    reply: "Three Stripe payouts landed in Mercury on November 2. October or November?",
    relay: "Leo needs one call from you. Should he count the three Stripe payouts in October?",
  },
};

export const Stopped: StoryObj<ReplyCardProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({ status: "stopped" }),
    reply: "",
    relay: "Leo stopped before he wrote anything back. He hadn't changed any notes yet.",
  },
};

export const DidntFinish: StoryObj<ReplyCardProps> = {
  args: {
    marker: LEO_MARKER,
    run: leoRun({
      status: "didnt_finish",
    }),
    reply: "",
    relay: "Leo didn't finish: his chat stopped with an error before he replied.",
  },
};

export const RunNotFound: StoryObj<ReplyCardProps> = {
  args: {
    relay: "Maya says six features in 90 seconds is too many.",
  },
};

export const SeveralAgents: StoryObj<ReplyCardProps> = {
  render: () => (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <AgentReplyMessage marker={MAYA_MARKER} reply="Cut the intro." onOpenFileChange={() => {}} />
      <AgentReplyMessage marker={LEO_MARKER} reply="$6,200 left." onOpenFileChange={() => {}} />
    </ChatAgentsContext.Provider>
  ),
};

export const LongName: StoryObj<ReplyCardProps> = {
  args: {
    marker: { agent: LONG_NAMED_AGENT.slug, name: LONG_NAMED_AGENT.name, mention: "m3" },
  },
};
