import type { ProjectConfig } from "@/aiParams";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { isPinned } from "@/agentMode/ui/RecentChatMenu";
import { arrayMove } from "@dnd-kit/sortable";

export const VISIBLE_PROJECTS = 5;
export const VISIBLE_CHATS_PER_PROJECT = 5;
export const RECENTS_PAGE_SIZE = 20;

export interface ProjectChatGroup {
  project: ProjectConfig;
  chats: ChatHistoryItem[];
}

export interface SessionsSidebarGroups {
  pinned: ChatHistoryItem[];
  projects: ProjectChatGroup[];
  recents: ChatHistoryItem[];
}

// Creation time, not last use, so opening or clicking a chat or project never moves it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
function byNewest(a: ChatHistoryItem, b: ChatHistoryItem): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

// A chat whose project is gone from `projects` (deleted) falls into Recents so it stays reachable.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
export function groupSessionsSidebarChats(
  items: readonly ChatHistoryItem[],
  projects: readonly ProjectConfig[],
  projectOrder: Iterable<string> = []
): SessionsSidebarGroups {
  const chatsByProject = new Map<string, ChatHistoryItem[]>(
    projects.map((project) => [project.id, []])
  );
  const pinned: ChatHistoryItem[] = [];
  const recents: ChatHistoryItem[] = [];
  for (const item of [...items].sort(byNewest)) {
    if (isPinned(item)) pinned.push(item);
    else if (item.projectId && chatsByProject.has(item.projectId)) {
      chatsByProject.get(item.projectId)!.push(item);
    } else recents.push(item);
  }
  pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  // A project the user has not placed yet (created since the last drag) leads the group, newest first.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/811
  const rank = new Map([...projectOrder].map((id, index) => [id, index]));
  const position = (project: ProjectConfig) => rank.get(project.id) ?? -1;
  return {
    pinned,
    projects: [...projects]
      .sort((a, b) => position(a) - position(b) || b.created - a.created)
      .map((project) => ({ project, chats: chatsByProject.get(project.id)! })),
    recents,
  };
}

// Pinned is ordered by pinnedAt, so a dragged pin takes a time between its new neighbours' and the other notes stay
// untouched; a pin made later still lands on top.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/811
export function pinnedAtAfterMove(
  pinned: readonly ChatHistoryItem[],
  from: number,
  to: number
): number {
  const times = arrayMove(
    pinned.map((item) => item.pinnedAt ?? 0),
    from,
    to
  );
  const above = times[to - 1];
  const below = times[to + 1];
  if (above === undefined) return below + 1;
  if (below === undefined) return above - 1;
  return (above + below) / 2;
}

export function filterChatsByTitle(
  items: readonly ChatHistoryItem[],
  query: string
): ChatHistoryItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => item.title.toLowerCase().includes(needle)).sort(byNewest);
}
