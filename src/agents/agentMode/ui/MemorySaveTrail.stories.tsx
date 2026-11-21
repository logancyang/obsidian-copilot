import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { MemorySaveTrail } from "@/agents/agentMode/memorySaveCards";
import type { MemorySave } from "@/agents/memorySaves";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;

const MEMORY_PATH = "copilot/teammates/coco/MEMORY.md";

function turn(saves: readonly MemorySave[], reply: string): AgentMessagePart[] {
  return [
    ...saves.map(
      ({ rule }, index): AgentMessagePart => ({
        kind: "tool_call",
        id: `save-${index}`,
        title: "save_memory",
        status: "completed",
        mcpServer: "obsidian-copilot",
        copilotTools: { calls: [{ name: "save_memory", args: { rule } }] },
      })
    ),
    { kind: "text", text: reply },
  ];
}

function trailOf(saves: readonly MemorySave[]): MemorySaveTrail {
  return {
    saves,
    byCall: new Map(saves.map((save, index) => [`save-${index}`, [save]])),
    unplaced: [],
  };
}

const REMEMBERED: MemorySave[] = [
  {
    agentName: "Coco",
    memoryPath: MEMORY_PATH,
    rule: "Launch videos lead with user value, not the feature list.",
  },
];

const REPLACED_AND_AGAINST: MemorySave[] = [
  {
    agentName: "Coco",
    memoryPath: MEMORY_PATH,
    rule: "Write summaries as short paragraphs, no bullet points.",
    replaced: "Summarize as bullet points.",
  },
  {
    agentName: "Coco",
    memoryPath: MEMORY_PATH,
    rule: "Taxes are Leo's job now. Point tax questions to Leo.",
    contradicts: "File quarterly estimated taxes.",
  },
];

const MIYO_QUERY = "launch video structure";

const MIYO_SEARCH: AgentMessagePart = {
  kind: "tool_call",
  id: "miyo-run",
  title: "miyo_search",
  status: "completed",
  mcpServer: "obsidian-copilot",
  vendorToolName: "miyo_search",
  input: { query: MIYO_QUERY },
  copilotTools: { calls: [{ name: "miyo_search", args: { query: MIYO_QUERY } }] },
  output: [
    {
      type: "text",
      text: JSON.stringify({
        results: [{ path: "Launch/4.0.20 video script.md" }, { path: "Launch/Video notes.md" }],
      }),
    },
  ],
};

const TrailWithSave: React.FC<{ parts: AgentMessagePart[]; memorySaves: MemorySaveTrail }> = ({
  parts,
  memorySaves,
}) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={false}
        turnDurationMs={22_000}
        timestampMs={new Date(2026, 10, 16, 14, 9, 31).getTime()}
        app={app}
        turnStopReason="end_turn"
        memorySaves={memorySaves}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Copilot Teammates/Memory Save In Chat",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

export const RememberedInPlaceOfTheCall: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailWithSave
      parts={turn(
        REMEMBERED,
        "Reworked: the video opens on someone asking Coco what's left this month and getting an answer that already knows their vault. The features follow, one line each, in the last 20 seconds."
      )}
      memorySaves={trailOf(REMEMBERED)}
    />
  ),
};

export const ReplacedAndAgainstTheInstruction: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailWithSave
      parts={turn(
        REPLACED_AND_AGAINST,
        "You shipped 4.0.20 on Tuesday and talked to two users. October's books still aren't reconciled."
      )}
      memorySaves={trailOf(REPLACED_AND_AGAINST)}
    />
  ),
};

export const BesideAMiyoSearch: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailWithSave
      parts={[
        MIYO_SEARCH,
        ...turn(
          REPLACED_AND_AGAINST,
          "Your last two scripts opened on the feature list. I reworked this one to open on the user's question."
        ),
      ]}
      memorySaves={trailOf(REPLACED_AND_AGAINST)}
    />
  ),
};
