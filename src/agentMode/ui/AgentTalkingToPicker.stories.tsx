import type { AgentEntry, CustomAgent } from "@/agents/types";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { AgentTalkingToPicker } from "@/agentMode/ui/AgentTalkingToPicker";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTalkingToPickerProps = React.ComponentProps<typeof AgentTalkingToPicker>;

/** The built-in entry as the manager publishes it (fixture, not the constant). */
const COPILOT: AgentEntry = {
  kind: "builtin",
  slug: "copilot",
  name: "Copilot",
  description: "Your vault instructions, no persona, no memory.",
  icon: "✦",
};

function agent(fields: {
  slug: string;
  name: string;
  icon: string;
  description: string;
}): AgentEntry {
  const custom: CustomAgent = {
    ...fields,
    backendId: null,
    modelId: null,
    effort: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "",
  };
  return { kind: "custom", ...fields, agent: custom };
}

const JENNIFER = agent({
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
});
const VANCAT = agent({
  slug: "vancat",
  name: "Vancat",
  icon: "🐈",
  description: "Research partner. Finds the paper you half-remember.",
});

const meta = {
  title: "Agent Mode/Talking To Picker",
  component: AgentTalkingToPicker,
  args: { entries: [COPILOT], selectedSlug: COPILOT.slug, onSelect: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTalkingToPickerProps>;
export default meta;

/** A vault with no agents yet: the feature is one quiet word in the header. */
export const CopilotOnly: StoryObj<AgentTalkingToPickerProps> = {};

/** Talking to an agent — the trigger keeps the height it had as "Copilot". */
export const WithAgents: StoryObj<AgentTalkingToPickerProps> = {
  args: { entries: [COPILOT, JENNIFER, VANCAT], selectedSlug: "jennifer" },
};

/** A description longer than the menu is wide must truncate, never wrap the row. */
export const LongDescription: StoryObj<AgentTalkingToPickerProps> = {
  args: {
    entries: [
      COPILOT,
      agent({
        slug: "the-long-winded-developmental-editor",
        name: "The Long-Winded Developmental Editor",
        icon: "📝",
        description:
          "Reads every draft twice, argues for the reader over the author, and will not let a vague claim past without a citation, a cut, or a fight.",
      }),
    ],
    selectedSlug: "the-long-winded-developmental-editor",
  },
};

/**
 * Inside a project: who answers sits above where the chat runs, and the two
 * rows stay independent (`designdocs/CUSTOM_AGENTS.md` §3).
 */
export const InsideAProject: StoryObj<AgentTalkingToPickerProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-w-full tw-items-center tw-px-2 tw-pt-1.5">
        <AgentTalkingToPicker
          entries={[COPILOT, JENNIFER]}
          selectedSlug="jennifer"
          onSelect={() => {}}
        />
      </div>
      <AgentProjectHeader projectName="Grid storage explainer" onExit={() => {}} />
    </div>
  ),
};
