export interface ProjectLandingPlacement {
  key: string;
  standalone: boolean;
}

export interface ProjectLandingHistory {
  settled: boolean;
  chatCount: number;
  archivedChatCount: number;
}

export function nextProjectLandingPlacement(
  previous: ProjectLandingPlacement | null,
  visitKey: string | null,
  history: ProjectLandingHistory
): ProjectLandingPlacement | null {
  if (visitKey === null) return null;
  if (!history.settled) return previous?.key === visitKey ? previous : null;
  // A project whose chats are all archived still needs its shelf for the View archived button.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/805
  const hasChats = history.chatCount > 0 || history.archivedChatCount > 0;
  if (previous?.key !== visitKey) return { key: visitKey, standalone: !hasChats };
  if (previous.standalone && hasChats) return { key: visitKey, standalone: false };
  return previous;
}
