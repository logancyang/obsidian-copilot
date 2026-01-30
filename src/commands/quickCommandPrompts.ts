/**
 * Quick Command system prompt and utility functions.
 * Shared across Quick Ask and Quick Command features.
 */

/**
 * System prompt for Quick Command / Quick Ask interactions.
 * Designed for precise, action-oriented responses.
 */
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

/**
 * Appends Include note context placeholders to user content if enabled.
 * Only adds placeholders that don't already exist in the content.
 *
 * @param userContent - The original user input content
 * @param includeActiveNote - Whether to include note context
 * @returns The content with placeholders appended if needed
 */
export function appendIncludeNoteContextPlaceholders(
  userContent: string,
  includeActiveNote: boolean
): string {
  if (!includeActiveNote) {
    return userContent;
  }

  // Check if placeholders already exist to avoid duplication
  const hasSelectedTextPlaceholder = userContent.includes("{}");
  const hasActiveNotePlaceholder = /\{activenote\}/i.test(userContent);

  // Only append placeholders that don't already exist
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
