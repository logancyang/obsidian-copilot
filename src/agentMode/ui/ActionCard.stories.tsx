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
      output: [
        { type: "text", text: "Image read successfully" },
        {
          type: "image",
          mimeType: "image/svg+xml",
          data: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTYwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjE2MCIgZmlsbD0iI2VkZjJmNyIvPjxjaXJjbGUgY3g9IjY1IiBjeT0iODAiIHI9IjM1IiBmaWxsPSIjNjM1YmZmIi8+PHBhdGggZD0iTTEwMCA4MGg0NSIgc3Ryb2tlPSIjNjQ3NDhiIiBzdHJva2Utd2lkdGg9IjQiLz48cmVjdCB4PSIxNDUiIHk9IjQ1IiB3aWR0aD0iNzAiIGhlaWdodD0iNzAiIHJ4PSI4IiBmaWxsPSIjMTRiOGE2Ii8+PC9zdmc+",
        },
      ],
    },
    open: false,
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;
export const ImageRead: StoryObj<Props> = {
  render: function ImageReadStory(args) {
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
export const ExpandedImageRead: StoryObj<Props> = { args: { open: true } };
