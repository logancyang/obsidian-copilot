import { TurnDiffHeader, type TurnDiffHeaderProps } from "@/agentMode/ui/TurnDiffHeader";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Turn Diff Header",
  component: TurnDiffHeader,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<TurnDiffHeaderProps>;
export default meta;

/** The ordinary case: a note the turn revised. */
export const Modified: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/alpha.md",
    status: "modified",
    additions: 12,
    deletions: 4,
    onOpenNote: () => {},
  },
};

/** A note the turn created, where the badge carries what the one-sided counts cannot. */
export const Created: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/meeting 2026-09-16.md",
    status: "created",
    additions: 28,
    deletions: 0,
    onOpenNote: () => {},
  },
};

/** A note the turn deleted, which offers no action because there is nothing left to open. */
export const Deleted: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/zeta.md",
    status: "deleted",
    additions: 0,
    deletions: 57,
  },
};

/** A deeply nested path, which truncates rather than pushing the counts off the row. */
export const LongPath: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/projects/alpha/2026/quarter-three/rollout/migration runbook and rollback plan.md",
    status: "modified",
    additions: 1284,
    deletions: 967,
    onOpenNote: () => {},
  },
};
