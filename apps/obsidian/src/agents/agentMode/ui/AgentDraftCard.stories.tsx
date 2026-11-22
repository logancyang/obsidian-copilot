import type { AgentDraft } from "@/agents/agentMode/agentDraftCard";
import { AgentDraftCard, type AgentDraftCardProps } from "@/agents/agentMode/ui/AgentDraftCard";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef, useState } from "react";

const NORA: AgentDraft = {
  name: "Nora",
  title: "Family calendar and school logistics",
  instruction:
    "You handle our family logistics: school pickups, after-school classes, camp sign-ups and the family calendar. The kids' notes are in Family/Kids/. Check the calendar before you suggest a time. Answer in short lines I can read on my phone.",
};

const NORA_REVISED: AgentDraft = {
  ...NORA,
  title: "School runs, swim class and summer camp",
  instruction:
    "You handle our family logistics: school pickups, the kids' swim class on Tuesdays and Thursdays, and summer camp sign-ups. The kids' notes are in Family/Kids/ and camp forms in Family/Camp/. Remind me of sign-up deadlines a week ahead. Answer in short lines I can read on my phone.",
};

const LONG_INSTRUCTION = [
  NORA.instruction,
  "Pickups: Mia finishes at 3:10 on weekdays and 12:40 on Wednesdays; Leo's bus drops him at 3:45. If both overlap with a meeting in my work calendar, say so and suggest who of us can go.",
  "Swim class is Tuesday and Thursday at 5:30 at the community pool. Pack list is in Family/Kids/Swim.md. Camp sign-ups open in March; keep a list of the camps we liked last year and their deadlines.",
  "Never book or pay for anything. Draft the email or the form answers and let me send them.",
].join("\n\n");

function clickButton(root: HTMLElement | null, label: string): void {
  [...(root?.querySelectorAll("button") ?? [])]
    .find((button) => button.textContent === label)
    ?.click();
}

interface DraftInChatProps {
  reply: string;
  drafts: readonly AgentDraft[];
  clickNotNow?: boolean;
}

function DraftInChat({ reply, drafts, clickNotNow }: DraftInChatProps) {
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clickNotNow) clickButton(ref.current, "Not now");
  }, [clickNotNow]);
  const latest = drafts[drafts.length - 1];
  return (
    <div ref={ref} className="tw-flex tw-flex-col">
      <div className="tw-px-3 tw-text-sm">{reply}</div>
      {latest && !dismissed && (
        <AgentDraftCard draft={latest} onDismiss={() => setDismissed(true)} onReview={() => {}} />
      )}
    </div>
  );
}

const meta = {
  title: "Copilot Teammates/Agent Draft Card",
  component: AgentDraftCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { draft: NORA, onDismiss: () => {}, onReview: () => {} },
} satisfies Meta<AgentDraftCardProps>;
export default meta;

export const ShortDraft: StoryObj<AgentDraftCardProps> = {};

export const LongInstruction: StoryObj<AgentDraftCardProps> = {
  args: { draft: { ...NORA, instruction: LONG_INSTRUCTION } },
};

export const LongName: StoryObj<AgentDraftCardProps> = {
  args: {
    draft: {
      ...NORA,
      name: "Nora the Family Calendar and School Logistics Coordinator",
      title:
        "Keeps school pickups, swim class, summer camp sign-ups and every family birthday in one place",
    },
  },
};

export const NameOnly: StoryObj<AgentDraftCardProps> = {
  args: { draft: { name: "Nora", title: "", instruction: "" } },
};

export const ReplacedByARevision: StoryObj<AgentDraftCardProps> = {
  render: () => (
    <DraftInChat
      reply="Updated: swim class and camp deadlines are in, and it reminds you a week ahead."
      drafts={[NORA, NORA_REVISED]}
    />
  ),
};

export const DismissedWithNotNow: StoryObj<AgentDraftCardProps> = {
  render: () => (
    <DraftInChat
      reply="Here's a draft. It says where things live and how to answer. The actual dates stay in your notes and the family calendar."
      drafts={[NORA]}
      clickNotNow
    />
  ),
};
