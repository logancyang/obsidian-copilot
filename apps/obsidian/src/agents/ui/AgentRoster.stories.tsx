import { LockedHomeNote } from "@/agents/ui/LockedAgentNotices";
import { AgentRoster, NewAgentButton, type AgentRosterProps } from "@/agents/ui/AgentRoster";
import {
  COCO,
  FIVE_AGENTS,
  LEO,
  LONG_NAMED_AGENT,
  MAYA,
  THREE_AGENTS,
  TWELVE_AGENTS,
} from "@/agents/ui/testing/rosterFixtures";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

const meta = {
  title: "Copilot Teammates/Agent Roster",
  component: AgentRoster,
  args: {
    agents: THREE_AGENTS,
    selectedSlug: null,
    onSelect: () => {},
    emptyHero: (
      <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-center tw-gap-3">
        <CopilotBrandIcon className="tw-size-6 tw-shrink-0 tw-text-normal" />
        <span className="tw-text-3xl tw-font-[330] tw-text-normal">What are you working on?</span>
      </div>
    ),
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentRosterProps>;
export default meta;

const LONGER_NAMED_AGENT = { ...LONG_NAMED_AGENT, name: "Nora · Family, School & Weekends" };
const UNTITLED_AGENT = {
  ...COCO,
  slug: "pip",
  name: "Pip",
  title: "",
  instruction: "Sorts the inbox folder into projects every morning. Asks before moving a note.",
};

const render = (args: Partial<AgentRosterProps>) => (
  <TooltipProvider>
    <AgentRoster {...(args as AgentRosterProps)} />
  </TooltipProvider>
);

export const NoAgents: StoryObj<AgentRosterProps> = {
  render,
  args: { agents: [] },
};

export const ThreeAgentsCopilotSelected: StoryObj<AgentRosterProps> = { render };

export const AgentPickedWithTitle: StoryObj<AgentRosterProps> = {
  render,
  args: { selectedSlug: "coco", onOpenProfile: () => {} },
};

function FocusedProfileFace(args: Partial<AgentRosterProps>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button[aria-label$="profile"]')
      ?.focus({ focusVisible: true } as FocusOptions);
  }, []);
  return <div ref={ref}>{render(args)}</div>;
}

export const AgentPickedFaceFocused: StoryObj<AgentRosterProps> = {
  render: (args) => <FocusedProfileFace {...args} />,
  args: { selectedSlug: "coco", onOpenProfile: () => {} },
};

export const AgentPickedWithoutTitle: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: [...THREE_AGENTS, UNTITLED_AGENT],
    selectedSlug: UNTITLED_AGENT.slug,
    onOpenProfile: () => {},
  },
};

export const SixAgentsFillTheRow: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: TWELVE_AGENTS.slice(0, 6),
    selectedSlug: "kai",
    newAgentButton: <NewAgentButton onClick={() => {}} />,
  },
};

export const TwelveAgentsSelectedStaysInRow: StoryObj<AgentRosterProps> = {
  render,
  args: { agents: TWELVE_AGENTS, selectedSlug: "gus" },
};

export const AgentFromMoreMenuSelectedBesideNewAgentButton: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: TWELVE_AGENTS,
    selectedSlug: "gus",
    onOpenProfile: () => {},
    newAgentButton: <NewAgentButton onClick={() => {}} />,
  },
};

export const LongNameAndTitle: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: [COCO, MAYA, LEO, LONGER_NAMED_AGENT],
    selectedSlug: LONGER_NAMED_AGENT.slug,
    onOpenProfile: () => {},
  },
};

export const ChineseNames: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: [
      { ...COCO, slug: "xiao-zhu-shou", name: "小助手儿", title: "整理每天的笔记" },
      { ...MAYA, slug: "yan-jiu-zhu-li", name: "研究助理", title: "读论文，写摘要" },
      { ...LEO, slug: "xie-zuo-xiao-bang-shou", name: "写作小帮手", title: "润色文章" },
    ],
    selectedSlug: "xiao-zhu-shou",
    onOpenProfile: () => {},
    newAgentButton: <NewAgentButton onClick={() => {}} />,
  },
};

export const ProfileFaceAndNewAgentSlots: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: FIVE_AGENTS,
    selectedSlug: "coco",
    onOpenProfile: () => {},
    newAgentButton: <NewAgentButton onClick={() => {}} />,
  },
};

export const NoAgentsWithNewAgentButton: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: [],
    emptyHero: (
      <span className="tw-text-3xl tw-font-[330] tw-text-normal">What are you working on?</span>
    ),
    newAgentButton: <NewAgentButton emphasized onClick={() => {}} />,
  },
};

export const NoAgentsWithLockedNewAgentButton: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: [],
    emptyHero: (
      <span className="tw-text-3xl tw-font-[330] tw-text-normal">What are you working on?</span>
    ),
    newAgentButton: <NewAgentButton emphasized locked onClick={() => {}} />,
  },
};

export const LockedAgentsWithoutValidLicense: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: FIVE_AGENTS,
    selectedSlug: null,
    locked: {
      onOpen: () => {},
      note: <LockedHomeNote onUnlock={() => {}} />,
    },
    newAgentButton: <NewAgentButton locked onClick={() => {}} />,
  },
};

export const OneAgentNeedsSetupOnThisDevice: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: FIVE_AGENTS,
    selectedSlug: "coco",
    onOpenProfile: () => {},
    needsSetup: new Set([LEO.slug]),
    newAgentButton: <NewAgentButton onClick={() => {}} />,
  },
};
