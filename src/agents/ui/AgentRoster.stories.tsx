import { AgentRoster, type AgentRosterProps } from "@/agents/ui/AgentRoster";
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
import React from "react";

const meta = {
  title: "Custom Agents/Agent Roster",
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

export const AgentSelectedWithTitleLine: StoryObj<AgentRosterProps> = {
  render,
  args: { selectedSlug: "coco" },
};

export const FiveAgentsFillTheRow: StoryObj<AgentRosterProps> = {
  render,
  args: { agents: FIVE_AGENTS, selectedSlug: "kai" },
};

export const TwelveAgentsSelectedStaysInRow: StoryObj<AgentRosterProps> = {
  render,
  args: { agents: TWELVE_AGENTS, selectedSlug: "gus" },
};

export const LongNameAndTitle: StoryObj<AgentRosterProps> = {
  render,
  args: { agents: [COCO, MAYA, LEO, LONG_NAMED_AGENT], selectedSlug: LONG_NAMED_AGENT.slug },
};

export const ProfileLinkAndNewAgentSlots: StoryObj<AgentRosterProps> = {
  render,
  args: {
    agents: FIVE_AGENTS,
    selectedSlug: "coco",
    onOpenProfile: () => {},
    newAgentButton: (
      <div className="tw-flex tw-w-[52px] tw-shrink-0 tw-flex-col tw-items-center tw-gap-1 tw-pt-1 tw-text-ui-smaller tw-text-muted">
        <span className="tw-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-dashed tw-border-border">
          +
        </span>
        New
      </div>
    ),
  },
};
