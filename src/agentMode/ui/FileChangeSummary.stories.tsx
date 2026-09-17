import type { Meta, StoryObj } from "@/lib/story";
import { FileChangeCounts, type FileChangeCountsProps } from "@/agentMode/ui/FileChangeSummary";
import React from "react";

const meta = {
  title: "Agent Mode/File Change Summary",
  component: FileChangeCounts,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FileChangeCountsProps>;
export default meta;

/** Counts alone: the ordinary case, where the agent revised an existing note. */
export const Counts: StoryObj<FileChangeCountsProps> = {
  args: { additions: 30, deletions: 2 },
};

/**
 * The counts of several files stacked as the card and the diff tab stack them.
 * Both columns must stay aligned as the numbers grow, and a zero must read as
 * muted rather than as a change.
 */
export const CountColumns: StoryObj<FileChangeCountsProps> = {
  render: () => (
    <div className="tw-flex tw-w-64 tw-flex-col tw-gap-1">
      {[
        { additions: 4, deletions: 1 },
        { additions: 128, deletions: 0 },
        { additions: 0, deletions: 57 },
      ].map((counts) => (
        <div key={counts.additions} className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm">
            notes/diff-demo/note.md
          </span>
          <FileChangeCounts {...counts} />
        </div>
      ))}
    </div>
  ),
};
