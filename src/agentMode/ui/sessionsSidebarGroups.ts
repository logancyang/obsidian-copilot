import type { ProjectConfig } from "@/aiParams";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { isPinned } from "@/agentMode/ui/RecentChatMenu";

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

function byNewest(a: ChatHistoryItem, b: ChatHistoryItem): number {
  return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
}

/**
 * `projects` arrive already ordered by last activity. A chat whose project is gone from that list
 * (deleted) falls into Recents so it stays reachable.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/802
 */
export function groupSessionsSidebarChats(
  items: readonly ChatHistoryItem[],
  projects: readonly ProjectConfig[]
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
  return {
    pinned,
    projects: projects.map((project) => ({ project, chats: chatsByProject.get(project.id)! })),
    recents,
  };
}

export function filterChatsByTitle(
  items: readonly ChatHistoryItem[],
  query: string
): ChatHistoryItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => item.title.toLowerCase().includes(needle)).sort(byNewest);
}
