import { ModelEnableList, type ModelEnableGroup } from "@/agentMode/ui/ModelEnableList";
import type { ModelCapability } from "@/constants";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ModelEnableListProps = React.ComponentProps<typeof ModelEnableList>;

/** Enough rows to exceed the `max-h-80` cap, so the internal scroll is the thing on screen. */
const LONG_GROUP: ModelEnableGroup = {
  key: "byok",
  label: "OpenAI",
  badge: "BYOK",
  rows: Array.from({ length: 18 }, (_, i) => ({
    id: `openai/model-${i}`,
    label: `gpt-nova-${i}`,
    enabled: i < 3,
  })),
};

const PLUS_GROUP: ModelEnableGroup = {
  key: "plus",
  label: "Copilot Plus",
  badge: "privacy",
  tooltip: "Copilot license required",
  highlight: true,
  rows: [
    {
      id: "plus/flash",
      label: "copilot-plus-flash",
      enabled: true,
      // Cast rather than importing the enum: the gallery fence bars runtime
      // values from `@/constants`, and a story only needs the wire string.
      capabilities: ["vision" as ModelCapability],
    },
    { id: "plus/deepseek", label: "copilot-plus-deepseek-v4-pro", enabled: true, capabilities: [] },
    { id: "plus/glm", label: "copilot-plus-glm-5.2", enabled: false, capabilities: [] },
  ],
};

/**
 * `isFree` belongs here rather than on a Plus row: it marks a zero-cost model
 * routed through a third party, which is what earns the privacy warning. A paid
 * Plus model carrying that flag is a combination production never produces.
 */
const FREE_GROUP: ModelEnableGroup = {
  key: "agent",
  label: "OpenCode",
  badge: "Agent Provided",
  rows: [{ id: "opencode/grok-code", label: "grok-code-fast-1", enabled: true, isFree: true }],
};

/** Search is controlled, so a story has to own the query for the field to behave. */
const Controlled: React.FC<{ groups: ModelEnableGroup[] }> = ({ groups }) => {
  const [query, setQuery] = React.useState("");
  return (
    <ModelEnableList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      onToggle={() => undefined}
    />
  );
};

const meta = {
  title: "Agent Mode/Model Enable List",
  component: ModelEnableList,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ModelEnableListProps>;
export default meta;

/** The state the height cap exists for: a catalog longer than the card. */
export const OverflowingCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[PLUS_GROUP, FREE_GROUP, LONG_GROUP]} />,
};

export const ShortCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[PLUS_GROUP, FREE_GROUP]} />,
};

export const Empty: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[]} />,
};

/**
 * No license: the Copilot group is synthesized rather than absent, in the same
 * highlighted first position a licensed user's group occupies. Every row carries
 * a lock and a disabled toggle — the group is an advertisement, not a control.
 */
export const LockedCopilotCatalog: StoryObj<ModelEnableListProps> = {
  args: {
    groups: [
      {
        key: "locked:copilot-plus",
        label: "Copilot",
        badge: "privacy",
        tooltip: "Copilot license required",
        highlight: true,
        rows: [
          {
            id: "__locked_copilot__copilot-plus-flash",
            label: "Copilot Plus Flash",
            description: "The default model: fastest responses and the most quota.",
            enabled: false,
            locked: true,
          },
          {
            id: "__locked_copilot__deepseek-v4-pro",
            label: "DeepSeek V4 Pro",
            description: "A top-tier model for the hardest reasoning and agentic tasks.",
            enabled: false,
            locked: true,
          },
          {
            id: "__locked_copilot__glm-5.2",
            label: "GLM-5.2",
            description:
              "A long-horizon frontier open model that beats some of the best closed models.",
            enabled: false,
            locked: true,
          },
        ],
      },
      {
        key: "byok:openrouter",
        label: "OpenRouter",
        badge: "BYOK",
        rows: [
          { id: "or-1", label: "google/gemini-3.5-flash", enabled: true },
          { id: "or-2", label: "qwen3-30b-a3b-thinking-2507", enabled: false },
        ],
      },
    ],
  },
};
