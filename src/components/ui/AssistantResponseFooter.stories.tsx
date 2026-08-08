import {
  AssistantResponseFooter,
  type AssistantResponseFooterProps,
} from "@/components/ui/AssistantResponseFooter";
import type { Meta, StoryObj } from "@/lib/story";
import { Copy, Sparkles, TextCursorInput } from "lucide-react";
import React from "react";

const meta = {
  title: "Agent Mode/Assistant Response Footer",
  component: AssistantResponseFooter,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AssistantResponseFooterProps>;
export default meta;

const StoryActions: React.FC = () => (
  <div className="tw-flex tw-items-center tw-gap-2 tw-text-muted">
    <TextCursorInput className="tw-size-icon-xs" />
    <Copy className="tw-size-icon-xs" />
  </div>
);

const CompletedDuration: React.FC = () => (
  <div className="tw-flex tw-items-center tw-gap-1.5 tw-pl-1 tw-text-ui-small tw-text-muted">
    <span className="tw-flex tw-size-icon-xs tw-shrink-0 tw-items-center tw-justify-start">
      <Sparkles className="tw-size-icon-xs" />
    </span>
    <span>
      <span className="tw-font-medium">Worked for</span>{" "}
      <span className="tw-tabular-nums">24s</span>
    </span>
  </div>
);

const CompletedResponseVariantsDemo: React.FC = () => (
  <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-5">
    <section className="tw-min-w-0">
      <div className="tw-mb-2 tw-text-xs tw-font-medium tw-text-muted">Completed duration</div>
      <AssistantResponseFooter
        leading={<CompletedDuration />}
        timestamp="2026/08/07 20:31:10"
        actions={<StoryActions />}
      />
    </section>

    <section className="tw-min-w-0">
      <div className="tw-mb-2 tw-text-xs tw-font-medium tw-text-muted">Timestamp fallback</div>
      <AssistantResponseFooter timestamp="2026/08/07 20:31:10" actions={<StoryActions />} />
    </section>
  </div>
);

/** Every footer shows either the duration or its timestamp, never both. */
export const CompletedResponseVariants: StoryObj<AssistantResponseFooterProps> = {
  render: CompletedResponseVariantsDemo,
};
