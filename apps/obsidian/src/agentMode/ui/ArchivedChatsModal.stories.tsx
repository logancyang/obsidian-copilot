import { ArchivedChatsList, type ArchivedChatsListProps } from "@/agentMode/ui/ArchivedChatsModal";
import type { Meta, StoryObj } from "@/lib/story";

const noop = async () => {};

const meta = {
  title: "Agent Mode/Archived Chats Dialog",
  component: ArchivedChatsList,
  args: {
    items: [],
    projects: [],
    onUnarchive: noop,
    onOpen: noop,
    onUnarchiveProject: noop,
    onOpenProject: noop,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ArchivedChatsListProps>;
export default meta;

export const Empty: StoryObj<ArchivedChatsListProps> = {};

const archivedProjects: ArchivedChatsListProps["projects"] = [
  ["Fall product launch", 2],
  ["Reading list cleanup", 9],
].map(([name, daysAgo], index) => ({
  id: `archived-project-${index}`,
  name: name as string,
  systemPrompt: "",
  contextSource: {},
  created: Date.parse("2026-06-01T12:00:00Z"),
  UsageTimestamps: Date.parse("2026-08-21T12:00:00Z"),
  archivedAt: Date.parse("2026-08-30T12:00:00Z") - (daysAgo as number) * 86_400_000,
}));

export const SeveralChats: StoryObj<ArchivedChatsListProps> = {
  args: {
    items: [
      ["Plan the fall product launch and collect the open questions", "claude"],
      ["Fix the sync conflict in the reading list", "codex"],
      ["Summarize the Q3 interview notes", "opencode"],
      ["Untitled chat", undefined],
    ].map(([title, backendId], index) => ({
      id: `chats/archived-${index}.md`,
      title: title as string,
      backendId,
      createdAt: new Date("2026-08-20T18:00:00Z"),
      lastAccessedAt: new Date("2026-08-21T18:00:00Z"),
      archivedAt: Date.parse("2026-08-28T12:00:00Z") - index * 86_400_000,
    })),
  },
};

export const ProjectsAndChats: StoryObj<ArchivedChatsListProps> = {
  args: { projects: archivedProjects, items: SeveralChats.args!.items },
};

export const OnlyProjects: StoryObj<ArchivedChatsListProps> = {
  args: { projects: archivedProjects },
};
