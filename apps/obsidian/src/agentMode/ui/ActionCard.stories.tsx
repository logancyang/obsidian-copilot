import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

type Props = React.ComponentProps<typeof ActionCard>;
const meta = {
  title: "Agent Mode/Action Card",
  component: ActionCard,
  args: {
    part: {
      kind: "tool_call",
      id: "read-image",
      title: "Read architecture.svg",
      vendorToolName: "Read",
      status: "completed",
      input: { file_path: "architecture.svg" },
      output: [{ type: "text", text: "Image read successfully" }],
    },
    open: false,
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;
export const ImageFileRead: StoryObj<Props> = {
  render: function ImageFileReadStory(args) {
    const [open, setOpen] = useState(false);
    return (
      <ActionCard
        {...meta.args}
        {...args}
        open={open}
        onToggle={() => setOpen((previous) => !previous)}
      />
    );
  },
};
export const ExpandedImageFileRead: StoryObj<Props> = { args: { open: true } };

const NESTED_NOTE_PATH = "copilot/projects/Launch plan/Pitch for people who already use AI.md";
const nestedNoteEdit: Props["part"] = {
  kind: "tool_call",
  id: "edit-nested-note",
  title: "Edit",
  vendorToolName: "Edit",
  status: "completed",
  input: { file_path: NESTED_NOTE_PATH },
  output: [
    {
      type: "diff",
      path: NESTED_NOTE_PATH,
      oldText: "Copilot answers questions about your notes.",
      newText: "Copilot keeps your knowledge organized while you write.",
    },
  ],
};
export const NestedNoteEdit: StoryObj<Props> = { args: { part: nestedNoteEdit } };
export const ExpandedNestedNoteEdit: StoryObj<Props> = {
  args: { part: nestedNoteEdit, open: true },
};
