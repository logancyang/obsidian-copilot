import { ChangeScroller, useChangeNavigation } from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { RenderedDiff, type RenderedDiffProps } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import {
  LONG_NOTE_SCATTERED_EDITS,
  NON_MARKDOWN_FILE,
  WORDING_CHANGE,
} from "@/agentMode/ui/renderedDiff/testing/fixtures";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

function ScrolledDiff(props: RenderedDiffProps): React.ReactElement {
  const navigation = useChangeNavigation();
  return (
    <div className="tw-flex tw-h-[560px] tw-flex-col">
      <ChangeScroller navigation={navigation}>
        <RenderedDiff {...props} />
      </ChangeScroller>
    </div>
  );
}

const meta = {
  title: "Agent Mode/Change Scroller",
  component: ScrolledDiff,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RenderedDiffProps>;
export default meta;

export const LongNoteWithScatteredEdits: StoryObj<RenderedDiffProps> = {
  args: LONG_NOTE_SCATTERED_EDITS,
};

export const SingleWordingChange: StoryObj<RenderedDiffProps> = { args: WORDING_CHANGE };

export const VerbatimLines: StoryObj<RenderedDiffProps> = { args: NON_MARKDOWN_FILE };
