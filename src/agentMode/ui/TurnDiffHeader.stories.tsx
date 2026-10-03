import { TurnDiffHeader, type TurnDiffHeaderProps } from "@/agentMode/ui/TurnDiffHeader";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Turn Diff Header",
  component: TurnDiffHeader,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<TurnDiffHeaderProps>;
export default meta;

export const Modified: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/alpha.md",
    status: "modified",
    additions: 12,
    deletions: 4,
    onOpenNote: () => {},
  },
};

export const Created: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/meeting 2026-09-16.md",
    status: "created",
    additions: 28,
    deletions: 0,
    onOpenNote: () => {},
  },
};

export const Deleted: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/diff-demo/zeta.md",
    status: "deleted",
    additions: 0,
    deletions: 57,
  },
};

export const LongPath: StoryObj<TurnDiffHeaderProps> = {
  args: {
    path: "notes/projects/alpha/2026/quarter-three/rollout/migration runbook and rollback plan.md",
    status: "modified",
    additions: 1284,
    deletions: 967,
    onOpenNote: () => {},
  },
};
