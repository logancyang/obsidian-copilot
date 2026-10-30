import { ExcalidrawToolCard } from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ExcalidrawToolCardProps = React.ComponentProps<typeof ExcalidrawToolCard>;

const meta = {
  title: "Agent Mode/Excalidraw Tool Card",
  component: ExcalidrawToolCard,
  args: {
    action: "create",
    status: "completed",
    path: "Incidents/Investigation playbook.excalidraw.md",
    failed: 0,
    open: false,
    onOpenDrawing: () => {},
    onToggle: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ExcalidrawToolCardProps>;
export default meta;

export const Drew: StoryObj<ExcalidrawToolCardProps> = {};

export const Drawing: StoryObj<ExcalidrawToolCardProps> = {
  args: { status: "in_progress" },
};

export const Edited: StoryObj<ExcalidrawToolCardProps> = {
  args: { action: "edit", path: "Boards/Sprint 14 board.excalidraw.md" },
};

export const Read: StoryObj<ExcalidrawToolCardProps> = {
  args: { action: "read", path: "Diagrams/Order platform.excalidraw.md" },
};

export const Stopped: StoryObj<ExcalidrawToolCardProps> = {
  args: { status: "cancelled" },
};

export const EditedAfterFailedWrites: StoryObj<ExcalidrawToolCardProps> = {
  args: { action: "edit", path: "Boards/Launch board.excalidraw.md", failed: 2 },
};

export const StepsOpen: StoryObj<ExcalidrawToolCardProps> = {
  args: {
    action: "edit",
    path: "Boards/Launch board.excalidraw.md",
    failed: 1,
    open: true,
    children: (
      <>
        <div className="tw-text-sm tw-text-muted">Excalidraw write</div>
        <div className="tw-text-sm tw-text-muted">Excalidraw render</div>
        <div className="tw-text-sm tw-text-error">
          No change made to Launch board.excalidraw.md: INVALID_INPUT: Unsupported field.
        </div>
      </>
    ),
  },
};

export const LongName: StoryObj<ExcalidrawToolCardProps> = {
  args: {
    failed: 3,
    path: "Projects/Platform/Checkout architecture with payments, events and the analytics pipeline.excalidraw.md",
  },
};
