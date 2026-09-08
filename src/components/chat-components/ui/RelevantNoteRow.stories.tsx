import { Button } from "@/components/ui/button";
import {
  RelevantNoteRow,
  type RelevantNoteRowProps,
} from "@/components/chat-components/ui/RelevantNoteRow";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import { AppContext, useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { App, TFile } from "obsidian";
import React, { useMemo, useState } from "react";

const PREVIEW_MARKDOWN = `---
tags: [design]
---
# Design principles

Start with a **clear question**, then gather evidence.

## Review checklist

- Describe the reader's goal.
- Keep the next action visible.
- Compare the result with the original question.

> A useful preview lets you decide whether to open the note.

Read [the Markdown guide](https://www.markdownguide.org/) for examples.

\`\`\`typescript
const nextAction = "Review the evidence";
\`\`\`

## Follow-up

Longer notes stay inside the preview. Scroll to continue reading without losing the note actions.
`;

function MarkdownHoverPreview(
  props: RelevantNoteRowProps & { content?: string }
): React.ReactElement {
  const app = useApp();
  const previewApp = useMemo<App>(() => {
    const file: unknown = Object.create(TFile.prototype);
    if (!(file instanceof TFile)) throw new Error("Expected a TFile fixture");
    Object.assign(file, {
      name: `${props.note.note.title}.md`,
      path: props.note.note.path,
      basename: props.note.note.title,
      extension: "md",
      vault: app.vault,
    });
    // Supply note content without creating files in the gallery's vault.
    return Object.assign(Object.create(app) as App, {
      vault: Object.assign(Object.create(app.vault) as App["vault"], {
        getAbstractFileByPath: (path: string) =>
          path === file.path ? file : app.vault.getAbstractFileByPath(path),
        cachedRead: (requested: TFile) =>
          requested === file
            ? Promise.resolve(props.content ?? PREVIEW_MARKDOWN)
            : app.vault.cachedRead(requested),
      }),
    });
  }, [app, props.content, props.note.note.path, props.note.note.title]);

  return (
    <AppContext.Provider value={previewApp}>
      <RelevantNoteRow {...props} />
    </AppContext.Provider>
  );
}

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

export const MarkdownPreview: StoryObj<RelevantNoteRowProps> = {
  render: MarkdownHoverPreview,
};

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

export const LongPreview: StoryObj<RelevantNoteRowProps> = {
  render: (props) => (
    <MarkdownHoverPreview {...baseArgs} {...props} content={PREVIEW_MARKDOWN.repeat(100)} />
  ),
};

export const MediaPreview: StoryObj<RelevantNoteRowProps> = {
  render: (props) => (
    <MarkdownHoverPreview
      {...baseArgs}
      {...props}
      content={
        "# Imported note\n\n![Remote image](https://example.invalid/image.png)\n\n![[Embedded note]]"
      }
    />
  ),
};
