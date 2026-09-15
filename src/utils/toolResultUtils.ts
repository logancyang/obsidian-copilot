/**
 * Utility functions for handling tool results
 */

/**
 * Wraps an error message with errorChunk tags.
 * This is the low-level formatting function used by both ThinkBlockStreamer and tool execution.
 * @param errorMessage - The error message to wrap
 * @returns Formatted error string with errorChunk tags
 */
function wrapErrorChunk(errorMessage: string): string {
  return `<errorChunk>${errorMessage}</errorChunk>`;
}

/**
 * Format error message with errorChunk tags for UI display.
 * Uses the same format as ThinkBlockStreamer.processErrorChunk() for consistency.
 * @param errorMessage - The error message to format
 * @param prefix - Optional prefix text to display before the error
 * @returns Formatted error string with newline and errorChunk tags
 */
export function formatErrorChunk(errorMessage: string, prefix?: string): string {
  const errorChunk = wrapErrorChunk(errorMessage);
  if (prefix) {
    return `${prefix}\n${errorChunk}`;
  }
  // Match ThinkBlockStreamer format: leading newline + errorChunk
  return `\n${errorChunk}`;
}
