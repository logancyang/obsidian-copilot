import { Button } from "@/components/ui/button";
import {
  RelevantNoteRow,
  type RelevantNoteRowProps,
} from "@/components/chat-components/ui/RelevantNoteRow";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import type { Meta, StoryObj } from "@/lib/story";
import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import React, { useState } from "react";

function entry(title: string, score: number, links: Partial<RelevantNoteEntry["metadata"]> = {}) {
  return {
    note: { path: `${title}.md`, title },
    metadata: { score, hasOutgoingLinks: false, hasBacklinks: false, ...links },
  } satisfies RelevantNoteEntry;
}

const baseArgs: RelevantNoteRowProps = {
  note: entry("Design principles", 0.86),
  exiting: false,
  entering: false,
  animated: true,
  rowRef: () => undefined,
  onAddToChat: () => undefined,
  onNavigateToNote: () => undefined,
};

/** Two rankings of the same notes, so the re-rank can be replayed on demand. */
const RANKINGS: RelevantNoteEntry[][] = [
  [
    entry("Design principles", 0.86),
    entry("Product research", 0.62),
    entry("Interview notes", 0.4),
  ],
  [entry("Product research", 0.91), entry("Weekly review", 0.55), entry("Design principles", 0.31)],
];

/**
 * Replays what a live re-query does to the list: rows slide to their new rank,
 * scores grow or shrink, an arriving note fades in and a departing one fades
 * out. Only the button advances it, so a screenshot is never mid-animation by
 * accident.
 */
function LiveRerank(): React.ReactElement {
  const [ranking, setRanking] = useState(0);
  const { rows, registerRow } = useRelevantNoteRowTransitions(
    RANKINGS[ranking % RANKINGS.length],
    "Weekly review.md",
    true
  );

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <Button variant="secondary" size="sm" onClick={() => setRanking((value) => value + 1)}>
        Re-rank
      </Button>
      {rows.map((row) => (
        <RelevantNoteRow
          key={row.note.note.path}
          note={row.note}
          exiting={row.exiting}
          entering={row.entering}
          animated
          rowRef={registerRow(row.note.note.path)}
          onAddToChat={() => undefined}
          onNavigateToNote={() => undefined}
        />
      ))}
    </div>
  );
}

const meta = {
  title: "Chat/Relevant Note Row",
  component: RelevantNoteRow,
  args: baseArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RelevantNoteRowProps>;

export default meta;

export const StrongMatch: StoryObj<RelevantNoteRowProps> = {};

export const WeakMatch: StoryObj<RelevantNoteRowProps> = {
  args: { note: entry("Interview notes", 0.28) },
};

export const LinkedBothWays: StoryObj<RelevantNoteRowProps> = {
  args: {
    note: entry("Product research", 0.72, { hasOutgoingLinks: true, hasBacklinks: true }),
  },
};

export const Arriving: StoryObj<RelevantNoteRowProps> = {
  args: { entering: true },
};

export const Leaving: StoryObj<RelevantNoteRowProps> = {
  args: { exiting: true },
};

export const ReducedMotion: StoryObj<RelevantNoteRowProps> = {
  args: { animated: false, entering: false },
};

export const LiveReranking: StoryObj<RelevantNoteRowProps> = {
  render: LiveRerank,
};
