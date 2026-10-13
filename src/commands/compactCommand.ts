export const COMPACT_COMMAND_NAME = "compact";

const COMPACT_COMMAND_PATTERN = new RegExp(`^/${COMPACT_COMMAND_NAME}(\\s|$)`);

export function isCompactCommand(text: string): boolean {
  return COMPACT_COMMAND_PATTERN.test(text.trim());
}
