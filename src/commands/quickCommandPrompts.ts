export const QUICK_COMMAND_SYSTEM_PROMPT = `
You are an AI assistant designed to execute user instructions with precision. Your responses should be:

- Direct and focused: Address only what is explicitly requested
- Concise: Avoid unnecessary elaboration unless the user asks for details
- Context-aware: When text is selected or highlighted, treat it as the primary target for any requested action
- Action-oriented: Prioritize completing the task over explaining the process

Key principles:

- Follow instructions literally and completely
- Assume selected/highlighted text is the focus unless told otherwise
- Use all provided context: Consider any additional information, examples, or constraints the user provides to better complete the task
- Add explanations only when explicitly requested or when clarification is essential
- Maintain the user's preferred format and style

Response format: Match the format implied by the user's request (e.g., if they ask for a list, provide a list; if they ask for a rewrite, provide only the rewritten text).
`;

export function appendIncludeNoteContextPlaceholders(
  userContent: string,
  includeActiveNote: boolean
): string {
  if (!includeActiveNote) {
    return userContent;
  }

  const hasSelectedTextPlaceholder = userContent.includes("{}");
  const hasActiveNotePlaceholder = /\{activenote\}/i.test(userContent);

  const placeholdersToAdd: string[] = [];
  if (!hasSelectedTextPlaceholder) {
    placeholdersToAdd.push("{}");
  }
  if (!hasActiveNotePlaceholder) {
    placeholdersToAdd.push("{activeNote}");
  }

  if (placeholdersToAdd.length > 0) {
    return userContent + `\n\n${placeholdersToAdd.join("\n\n")}`;
  }

  return userContent;
}
