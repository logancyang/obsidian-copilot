/**
 * Utility functions for handling tool results
 */

export const DEFAULT_TOOL_RESULT_MAX_LENGTH = 10000; // Default max length for tool results in chat memory

/**
 * Get the configured max length for tool results
 */
function getToolResultMaxLength(): number {
  return DEFAULT_TOOL_RESULT_MAX_LENGTH;
}

/**
 * Truncate tool result if it exceeds the maximum length
 * @param result The tool result string
 * @param maxLength Maximum allowed length (default: from settings)
 * @returns Truncated result with ellipsis if needed
 */
export function truncateToolResult(result: string, maxLength?: number): string {
  const actualMaxLength = maxLength ?? getToolResultMaxLength();
  if (!result || result.length <= actualMaxLength) {
    return result;
  }

  // Truncate and add ellipsis with info about truncation
  const truncated = result.substring(0, actualMaxLength);
  const remainingChars = result.length - actualMaxLength;

  return `${truncated}\n\n... (truncated ${remainingChars.toLocaleString()} characters)`;
}

/**
 * Format tool result for memory storage
 * @param toolName The name of the tool
 * @param result The raw tool result
 * @param maxLength Maximum allowed length
 * @returns Formatted and truncated tool result
 */
export function formatToolResultForMemory(
  toolName: string,
  result: string,
  maxLength?: number
): string {
  const truncatedResult = truncateToolResult(result, maxLength);
  return `Tool '${toolName}' result: ${truncatedResult}`;
}

/**
 * Process tool results for different contexts
 * @param toolResults Array of tool execution results
 * @param truncate Whether to truncate the results
 * @returns Formatted tool results string
 */
export function processToolResults(
  toolResults: Array<{ toolName: string; result: string }>,
  truncate: boolean = false
): string {
  return toolResults
    .map((result) => {
      const formattedResult = truncate
        ? formatToolResultForMemory(result.toolName, result.result)
        : `Tool '${result.toolName}' result: ${result.result}`;
      return formattedResult;
    })
    .join("\n\n");
}
