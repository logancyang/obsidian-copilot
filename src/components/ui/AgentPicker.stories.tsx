import React, { type ComponentProps } from "react";
import { Plus } from "lucide-react";
import { AgentPicker, type AgentPickerRow } from "@/components/ui/AgentPicker";
import { Button } from "@/components/ui/button";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";

type Props = ComponentProps<typeof AgentPicker>;
const meta = {
  title: "UI/Agent Picker",
  component: AgentPicker,
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

const COPILOT_ROW: AgentPickerRow = {
  slug: "copilot",
  name: "Copilot",
  icon: "✦",
  description: "Your vault instructions, no persona, no memory.",
  modelKey: null,
  effort: null,
};

const JENNIFER_ROW: AgentPickerRow = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  modelKey: "other|agent",
  effort: "high",
};

const VANCAT_ROW: AgentPickerRow = {
  slug: "vancat",
  name: "Vancat",
  icon: "🐈",
  description: "Research partner. Finds the paper you half-remember.",
  modelKey: null,
  effort: null,
};

const LONG_NAME_ROW: AgentPickerRow = {
  slug: "the-long-winded-developmental-editor",
  name: "The Long-Winded Developmental Editor",
  icon: "📝",
  description:
    "Reads every draft twice, argues for the reader over the author, and will not let a vague claim past without a citation, a cut, or a fight.",
  modelKey: null,
  effort: null,
};

/** Filler agents, so the roster can be seen at the sizes real teams reach. */
const teamOf = (count: number): AgentPickerRow[] =>
  Array.from({ length: count }, (_, i) => ({
    slug: `agent-${i + 1}`,
    name: `Agent ${i + 1}`,
    icon: "🟦",
    description: `Stands in for the ${i + 1}th agent a real team would hold.`,
    modelKey: null,
    effort: null,
  }));

const section = (rows: AgentPickerRow[], selectedSlug: string): Props["section"] => ({
  rows,
  selectedSlug,
  onSelect: () => undefined,
  onOpen: () => undefined,
});

/** A vault with no agents yet: the default assistant, named. */
export const TriggerCopilot: StoryObj<Props> = {
  args: { section: section([COPILOT_ROW], "copilot") },
};

/** A chat held with an agent reads as that agent, icon first. */
export const TriggerNamedAgent: StoryObj<Props> = {
  args: { section: section([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW], "jennifer") },
};

/**
 * A name longer than the composer row is wide truncates rather than pushing the
 * model picker off the row; check it against the gallery's narrow widths.
 */
export const TriggerLongName: StoryObj<Props> = {
  args: { section: section([COPILOT_ROW, LONG_NAME_ROW], "the-long-winded-developmental-editor") },
};

/** The roster one click opens, as a vault with two agents holds it. */
export const RosterTwoAgents: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    section: section([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW], "jennifer"),
  },
};

/** Six entries: the largest roster that still reads without a search field. */
export const RosterSixAgents: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    section: section([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW, ...teamOf(3)], "vancat"),
  },
};

/** Twelve entries: past six the list scrolls, so a search field heads it. */
export const RosterSearchable: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    section: section([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW, ...teamOf(9)], "copilot"),
  },
};

/** A description longer than the list is wide wraps to two lines, then clamps. */
export const RosterLongDescription: StoryObj<Props> = {
  args: {
    defaultOpen: true,
    section: section([COPILOT_ROW, LONG_NAME_ROW], "the-long-winded-developmental-editor"),
  },
};

const MODEL_OVERRIDE: ComponentProps<typeof ModelEffortPicker>["override"] = {
  models: [
    { name: "example", displayName: "Sonnet 4.6", provider: "agent", enabled: true },
    { name: "other", displayName: "Opus 4.4", provider: "agent", enabled: true },
  ],
  value: "example|agent",
  effort: {
    value: "low",
    options: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    onChange: () => undefined,
  },
  effortOptionsByModelKey: {
    "example|agent": [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    "other|agent": [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
  },
  commitSelection: () => undefined,
};

/**
 * The composer's bottom row as Agent Mode draws it: Add Context, then who is
 * answering, then what they answer on — one click each
 * (`designdocs/CUSTOM_AGENTS.md` §3). Narrow the canvas to watch the two
 * triggers share the row. The "+" is the same primitive the production button
 * is built from, which the gallery's import fence keeps out of reach.
 */
export const ComposerRow: StoryObj<Props> = {
  render: () => (
    <div className="tw-flex tw-h-7 tw-justify-between tw-gap-1 tw-px-1">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
        <Button variant="ghost2" size="icon" className="tw-text-muted" aria-label="Add context">
          <Plus className="tw-size-4" />
        </Button>
        <AgentPicker section={section([COPILOT_ROW, JENNIFER_ROW, VANCAT_ROW], "jennifer")} />
        <ModelEffortPicker
          override={MODEL_OVERRIDE}
          className="tw-min-w-0 tw-max-w-full tw-truncate"
        />
      </div>
    </div>
  ),
};
