import type { Meta, StoryObj } from "@/lib/story";
import type { TurnFileChange } from "@/agentMode/session/types";
import { FilesChangedCard, type FilesChangedCardProps } from "@/agentMode/ui/FilesChangedCard";

function change(
  path: string,
  additions: number,
  deletions: number,
  status: TurnFileChange["status"] = "modified"
): TurnFileChange {
  return {
    path,
    status,
    before: status === "created" ? null : "before\n",
    after: status === "deleted" ? null : "after\n",
    additions,
    deletions,
  };
}

const meta = {
  title: "Agent Mode/Files Changed Card",
  component: FilesChangedCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onOpen: () => {} },
} satisfies Meta<FilesChangedCardProps>;
export default meta;

export const SingleFile: StoryObj<FilesChangedCardProps> = {
  args: { changes: [change("projects/Alpha/Project brief.md", 30, 2)] },
};

export const MixedTurn: StoryObj<FilesChangedCardProps> = {
  args: {
    changes: [
      change("projects/Alpha/Project brief.md", 30, 2),
      change("Meeting 2026-09-16.md", 12, 0, "created"),
      change("README.md", 0, 5),
    ],
  },
};

export const TenFiles: StoryObj<FilesChangedCardProps> = {
  args: {
    changes: [
      change("notes/diff-demo/alpha.md", 12, 3),
      change("notes/diff-demo/beta.md", 4, 4),
      change("notes/diff-demo/delta.md", 0, 9),
      change("notes/diff-demo/epsilon.md", 7, 0, "created"),
      change("notes/diff-demo/gamma.md", 21, 1),
      change("notes/diff-demo/iota.md", 5, 0, "created"),
      change("notes/diff-demo/theta.md", 3, 2),
      change("notes/diff-demo/zeta.md", 8, 8),
      change("Daily/2026-09-16.md", 2, 0),
      change("Inbox/Scratch.md", 0, 14, "deleted"),
    ],
  },
};

export const CreatedAndDeleted: StoryObj<FilesChangedCardProps> = {
  args: {
    changes: [
      change("notes/diff-demo/alpha.md", 6, 2),
      change("notes/diff-demo/epsilon.md", 18, 0, "created"),
      change("Inbox/Scratch.md", 0, 23, "deleted"),
    ],
  },
};

export const LongPaths: StoryObj<FilesChangedCardProps> = {
  args: {
    changes: [
      change(
        "projects/2026/Q3/Research/Competitive landscape/Notes on the vendor evaluation workshop.md",
        142,
        87
      ),
      change("Areas/Personal knowledge management/Weekly review template v2 (revised).md", 9, 0),
    ],
  },
};
