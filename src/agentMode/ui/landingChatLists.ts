import type { AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";

const CHAT_LIST_SECTION_IDS: ReadonlySet<string> = new Set(["chats", "projects"]);

export function withoutChatLists(sections: AgentHomeShelfSection[]): AgentHomeShelfSection[] {
  return sections.filter((section) => !CHAT_LIST_SECTION_IDS.has(section.id));
}

export function isProjectContextInline(
  placementStandalone: boolean | undefined,
  sidebarOpen: boolean
): boolean {
  return sidebarOpen || placementStandalone === true;
}
