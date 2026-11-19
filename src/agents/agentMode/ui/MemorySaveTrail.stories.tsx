import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { MemorySaveTrail } from "@/agents/agentMode/memorySaveCards";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;

const MEMORY_PATH = "copilot/agents/coco/MEMORY.md";

function turn(reply: string): AgentMessagePart[] {
  return [
    {
      kind: "tool_call",
      id: "save",
      title: "Edit MEMORY.md",
      status: "completed",
      toolKind: "edit",
      vendorToolName: "Edit",
      input: { file_path: `/vault/${MEMORY_PATH}` },
      locations: [{ path: `/vault/${MEMORY_PATH}` }],
    },
    { kind: "text", text: reply },
  ];
}

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

export const RememberedInPlaceOfTheEdit: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailWithSave
      parts={turn(
        "Reworked: the video opens on someone asking Coco what's left this month and getting an answer that already knows their vault. The features follow, one line each, in the last 20 seconds."
      )}
      memorySaves={{
        anchorId: "save",
        saves: [
          {
            agentName: "Coco",
            memoryPath: MEMORY_PATH,
            rule: "Launch videos lead with user value, not the feature list.",
          },
        ],
      }}
    />
  ),
};

export const ReplacedAndAgainstTheInstruction: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailWithSave
      parts={turn(
        "You shipped 4.0.20 on Tuesday and talked to two users. October's books still aren't reconciled."
      )}
      memorySaves={{
        anchorId: "save",
        saves: [
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
        ],
      }}
    />
  ),
};
