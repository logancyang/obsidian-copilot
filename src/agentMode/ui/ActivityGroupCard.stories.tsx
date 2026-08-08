import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import type { ActivityGroupNode, ActivityMember } from "@/agentMode/ui/activityGroups";
import { activityLiveStep } from "@/agentMode/ui/activityLiveStep";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

type ActivityGroupCardProps = React.ComponentProps<typeof ActivityGroupCard>;

function action(title: string, overrides: Partial<ToolCallPart> = {}): ActivityMember {
  return {
    type: "action",
    part: { kind: "tool_call", id: title, title, status: "completed", ...overrides },
  };
}

const THINKING: ActivityMember = {
  type: "reasoning",
  part: { kind: "thought", text: "The migration note is the one that changed most recently." },
};

function group(members: ActivityMember[]): ActivityGroupNode {
  return { type: "activityGroup", id: "activity-0", members };
}

/** Stands in for the trail's dispatch so stories stay free of plugin state. */
function renderMember(member: ActivityMember, key: string | number): React.ReactNode {
  return (
    <div key={key} className="tw-truncate tw-py-1 tw-text-sm tw-text-muted">
      {member.type === "action" ? member.part.title : "Thought about the vault layout"}
    </div>
  );
}

const MIXED = group([
  action("Read Projects/Copilot/Roadmap.md", { vendorToolName: "Read" }),
  THINKING,
  action("npm run lint", { vendorToolName: "Bash" }),
  action("npm run test -- activityGroups", { vendorToolName: "Bash" }),
  action("Edit Projects/Copilot/Roadmap.md", { vendorToolName: "Edit" }),
]);

const meta = {
  title: "Agent Mode/Activity Group Card",
  component: ActivityGroupCard,
  args: {
    group: MIXED,
    open: false,
    onToggle: () => undefined,
    renderMember,
    thinkingMs: 51_000,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ActivityGroupCardProps>;
export default meta;

export const Collapsed: StoryObj<ActivityGroupCardProps> = {};

export const WithFailure: StoryObj<ActivityGroupCardProps> = {
  args: {
    group: group([
      action("rg --files Daily/", { vendorToolName: "Grep" }),
      action("npm run build", { vendorToolName: "Bash", status: "failed" }),
      THINKING,
      action("npm run build", { vendorToolName: "Bash" }),
    ]),
    thinkingMs: 7_000,
  },
};

export const InFlight: StoryObj<ActivityGroupCardProps> = {
  args: {
    group: group([
      action("Read Meetings/2026-08-03 Standup.md", { vendorToolName: "Read" }),
      THINKING,
      action("npm run test -- ActivityGroupCard", {
        vendorToolName: "Bash",
        status: "in_progress",
      }),
    ]),
    thinkingMs: 3_000,
    liveStep: "npm run test -- ActivityGroupCard",
  },
};

/** Searches, fetches, MCP calls, unregistered tools — all pool as commands. */
export const LongLine: StoryObj<ActivityGroupCardProps> = {
  args: {
    group: group([
      action("Read Research/Vector Stores.md", { vendorToolName: "Read" }),
      action("Read Research/Chunking.md", { vendorToolName: "Read" }),
      action("Grep for “embedding”", { vendorToolName: "Grep" }),
      action("Fetch https://docs.obsidian.md/Plugins", { vendorToolName: "WebFetch" }),
      action("mcp call", { mcpServer: "obsidian-vault-search" }),
      action("Design sync", { vendorToolName: "DesignSyncFromFigmaWorkspace" }),
      THINKING,
    ]),
    thinkingMs: 214_000,
  },
};

/** Expansion is owned by the trail, so a story has to supply the state itself. */
const ExpandedDemo: React.FC = () => {
  const [open, setOpen] = useState(true);
  return (
    <ActivityGroupCard
      group={MIXED}
      thinkingMs={51_000}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      renderMember={renderMember}
    />
  );
};

export const Expanded: StoryObj<ActivityGroupCardProps> = { render: ExpandedDemo };

/**
 * The group as it grows: each frame appends the member the agent just started,
 * so the live row swaps while the summary line above it thickens. The last
 * frame is the settled turn, where the live row retires entirely.
 */
const LIVE_FRAMES: ActivityMember[][] = [
  [action("Read Projects/Copilot/Roadmap.md", { vendorToolName: "Read" }), THINKING],
  [
    action("Read Projects/Copilot/Roadmap.md", { vendorToolName: "Read" }),
    THINKING,
    action("lint", {
      vendorToolName: "Bash",
      status: "in_progress",
      input: { command: "npm run lint" },
    }),
  ],
  [
    action("Read Projects/Copilot/Roadmap.md", { vendorToolName: "Read" }),
    THINKING,
    action("lint", { vendorToolName: "Bash", input: { command: "npm run lint" } }),
    action("test", {
      vendorToolName: "Bash",
      status: "in_progress",
      input: { command: "npm run test -- activityLiveStep" },
    }),
  ],
  [
    action("Read Projects/Copilot/Roadmap.md", { vendorToolName: "Read" }),
    THINKING,
    action("lint", { vendorToolName: "Bash", input: { command: "npm run lint" } }),
    action("test", {
      vendorToolName: "Bash",
      input: { command: "npm run test -- activityLiveStep" },
    }),
  ],
];

/** Stepped by hand rather than by a timer so the frame under review holds still. */
const LiveEdgeDemo: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const members = LIVE_FRAMES[frame];
  const isStreaming = frame < LIVE_FRAMES.length - 1;
  return (
    <div className="tw-flex tw-flex-col tw-items-start tw-gap-2">
      <ActivityGroupCard
        group={group(members)}
        thinkingMs={4_000}
        open={false}
        onToggle={() => undefined}
        renderMember={renderMember}
        liveStep={activityLiveStep(members, isStreaming)}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setFrame((f) => (f + 1) % LIVE_FRAMES.length)}
      >
        {isStreaming ? "Next step" : "Restart"}
      </Button>
    </div>
  );
};

export const LiveEdge: StoryObj<ActivityGroupCardProps> = { render: LiveEdgeDemo };
