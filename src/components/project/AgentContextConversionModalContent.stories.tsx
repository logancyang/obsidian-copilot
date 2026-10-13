import { AgentContextConversionModalContent } from "./AgentContextConversionModalContent";
import type { ProcessingItem } from "./processingAdapter";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type Props = React.ComponentProps<typeof AgentContextConversionModalContent>;

const noop = () => {};

const meta = {
  title: "Project/Context Conversion Status",
  component: AgentContextConversionModalContent,
  args: {
    items: [],
    hasConfiguredContextSource: true,
    skippedMarkdownCount: 0,
    onRetryItem: noop,
    onRetryAll: noop,
    onEditContext: noop,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

const url = (id: string, status: ProcessingItem["status"], error?: string): ProcessingItem => ({
  id,
  name: id,
  cacheKind: "web",
  status,
  ...(error !== undefined ? { error } : {}),
});

export const BinaryFilesReadInPlace: StoryObj<Props> = {
  args: { items: [], hasConfiguredContextSource: true, skippedMarkdownCount: 0 },
};

export const ContextFailed: StoryObj<Props> = {
  args: {
    items: [],
    contextFailure: "EACCES: permission denied, mkdir '/vault/.copilot/context-cache'",
  },
};

export const MarkdownOnly: StoryObj<Props> = {
  args: { items: [], hasConfiguredContextSource: true, skippedMarkdownCount: 12 },
};

export const NoContext: StoryObj<Props> = {
  args: { items: [], hasConfiguredContextSource: false },
};

export const UrlsReady: StoryObj<Props> = {
  args: {
    items: [url("https://example.com/guide", "ready"), url("https://example.com/faq", "ready")],
  },
};

export const UrlsWithFailure: StoryObj<Props> = {
  args: {
    items: [
      url("https://example.com/guide", "ready"),
      url(
        "https://example.com/paywalled",
        "failed",
        "empty content for https://example.com/paywalled"
      ),
      url("https://example.com/slow", "processing"),
    ],
  },
};
