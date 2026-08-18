import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { ScrollToBottomButton, type ScrollToBottomButtonProps } from "./ScrollToBottomButton";

const meta = {
  title: "Chat/Scroll To Bottom Button",
  component: ScrollToBottomButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ScrollToBottomButtonProps>;
export default meta;

// The button is absolutely positioned by design, so the story recreates its
// real boundary: a relative, clipped message-list container it floats over.
export const OverMessageList: StoryObj<ScrollToBottomButtonProps> = {
  render: () => (
    <div className="tw-relative tw-h-64 tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border">
      <div className="tw-h-full tw-overflow-y-auto tw-p-4 tw-text-muted">
        <p>
          The printing press had profound and far-reaching consequences. Martin Luther&apos;s 95
          Theses were printed and distributed across Germany within weeks.
        </p>
        <p>
          By 1500 — just 50 years after Gutenberg&apos;s Bible — an estimated 20 million volumes had
          been printed, more books than had been produced in all of European history up to that
          point.
        </p>
        <p>
          The early printers were often former scribes, goldsmiths, or merchants who saw the
          commercial opportunity. They produced Bibles, psalters, and religious tracts first, but
          quickly expanded into classical texts, legal codes, grammars, and popular literature.
        </p>
      </div>
      <ScrollToBottomButton onClick={() => {}} />
    </div>
  ),
};
