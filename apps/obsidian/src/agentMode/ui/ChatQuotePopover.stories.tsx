import type { ComponentProps } from "react";
import React from "react";
import { ChatQuoteMenu } from "@/agentMode/ui/ChatQuotePopover";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { Meta, StoryObj } from "@/lib/story";

type Props = ComponentProps<typeof ChatQuoteMenu>;

function OverSelection(args: Props) {
  return (
    <div className="tw-pt-40">
      <Popover open>
        <PopoverAnchor asChild>
          <span className="tw-bg-[var(--text-selection)]">
            Run the migration before the deploy.
          </span>
        </PopoverAnchor>
        <PopoverContent side="top" className="tw-w-auto tw-p-1">
          <ChatQuoteMenu {...args} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const meta = {
  title: "Chat/Quote popover",
  component: ChatQuoteMenu,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onAdd: () => {} },
} satisfies Meta<Props>;
export default meta;

export const Actions: StoryObj<Props> = { render: OverSelection };
export const Commenting: StoryObj<Props> = {
  args: { startCommenting: true },
  render: OverSelection,
};
