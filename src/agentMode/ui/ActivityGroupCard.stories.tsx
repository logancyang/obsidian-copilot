import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import type { ActivityGroupNode, ActivityMember } from "@/agentMode/ui/activityGroups";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
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
  parameters: { gallery: { host: "leaf", layout: "padded", width: 340 } },
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

export const ManyFamilies: StoryObj<ActivityGroupCardProps> = {
  args: {
    group: group([
      action("Read Inbox/Clippings.md", { vendorToolName: "Read" }),
      action("Grep for “embedding”", { vendorToolName: "Grep" }),
      action("npm run format", { vendorToolName: "Bash" }),
      action("Fetch https://docs.obsidian.md/Plugins", { vendorToolName: "WebFetch" }),
      action("List Attachments/", { vendorToolName: "LS" }),
      THINKING,
    ]),
  },
};

export const LongLine: StoryObj<ActivityGroupCardProps> = {
  args: {
    group: group([
      action("Read Research/Vector Stores.md", { vendorToolName: "Read" }),
      action("Read Research/Chunking.md", { vendorToolName: "Read" }),
      action("mcp call", { mcpServer: "obsidian-vault-search" }),
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
