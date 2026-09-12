import { ActionCard } from "@/agentMode/ui/ActionCard";
import { MULTI_HUNK_DIFF, WHITESPACE_DIFF, NEW_NOTE_DIFF } from "@/agentMode/ui/toolDiff.fixtures";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type ActionCardProps = React.ComponentProps<typeof ActionCard>;
const part = {
  kind: "tool_call" as const,
  id: "edit",
  title: "Edit notes",
  toolKind: "edit" as const,
  status: "completed" as const,
  output: [MULTI_HUNK_DIFF],
};

const meta = {
  title: "Agent Mode/Action Card",
  component: ActionCard,
  args: { part, open: true, onToggle: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ActionCardProps>;
export default meta;

export const MultiHunkEdit: StoryObj<ActionCardProps> = {};
export const WhitespaceEdit: StoryObj<ActionCardProps> = {
  args: { part: { ...part, output: [WHITESPACE_DIFF] } },
};
export const NewNote: StoryObj<ActionCardProps> = {
  args: { part: { ...part, output: [NEW_NOTE_DIFF] } },
};
