import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";
import { ContentArea } from "./content-area";

type ContentAreaProps = ComponentProps<typeof ContentArea>;

const RESULT =
  "The quarterly review shows steady growth across all regions, with the strongest gains in onboarding and retention.";

const meta = {
  title: "Commands/Result area",
  component: ContentArea,
  args: {
    state: { type: "result", text: RESULT },
    editable: true,
    value: RESULT,
    disableAutoGrow: true,
    minHeight: "0px",
    onChange: () => undefined,
    onCopy: () => undefined,
    renderMarkdown: async (content: string, el: HTMLElement) => {
      el.setText(content);
    },
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ContentAreaProps>;
export default meta;

export const RenderedResult: StoryObj<ContentAreaProps> = {};
export const Streaming: StoryObj<ContentAreaProps> = {
  args: { state: { type: "result", text: RESULT, isStreaming: true } },
};
