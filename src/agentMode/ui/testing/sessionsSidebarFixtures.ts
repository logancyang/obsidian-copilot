import type { ProjectConfig } from "@/aiParams";
import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";

const NOW_MS = Date.parse("2026-10-31T09:00:00Z");

export function sidebarChat(
  id: string,
  title: string,
  minutesAgo: number,
  extra: Partial<ChatHistoryItem> = {}
): ChatHistoryItem {
  const at = new Date(NOW_MS - minutesAgo * 60_000);
  return { id, title, createdAt: at, lastAccessedAt: at, ...extra };
}

export function sidebarProject(id: string, name: string): ProjectConfig {
  return { id, name, created: NOW_MS } as ProjectConfig;
}

export function inertChatActions(overrides: Partial<RecentChatActions> = {}): RecentChatActions {
  const noop = async () => {};
  return {
    onUpdateTitle: noop,
    onCopyChatLink: noop,
    getChatBookmarkState: async () => "not-bookmarked",
    onSetChatBookmarked: noop,
    onDeleteChat: noop,
    onOpenSourceFile: () => {},
    onSetChatPinned: noop,
    onSetChatArchived: noop,
    ...overrides,
  };
}
