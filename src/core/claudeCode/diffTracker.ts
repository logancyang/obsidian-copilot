/**
 * Diff Tracker for Claude Code
 *
 * Tracks file changes made by Write and Edit tools, capturing before/after
 * states and computing unified diffs for display in the UI.
 */

import { logInfo, logWarn } from "@/logger";

/**
 * Maximum file size to track (100KB)
 * Files larger than this won't have their content captured
 */
const MAX_FILE_SIZE = 100 * 1024;

/**
 * State captured before a tool execution
 */
interface PreToolState {
  /** Tool name that was invoked */
  toolName: string;
  /** Path to the file being modified */
  filePath: string;
  /** Original file content (null if file didn't exist) */
  originalContent: string | null;
  /** Timestamp when state was captured */
  timestamp: number;
}

/**
 * Complete diff record including before and after states
 */
interface DiffRecord {
  /** Tool name */
  toolName: string;
  /** File path */
  filePath: string;
  /** Original content */
  originalContent: string | null;
  /** New content after modification */
  newContent: string | null;
  /** Computed unified diff */
  diff: string | null;
  /** Timestamp */
  timestamp: number;
}

/**
 * File operation tools that modify files
 */
const FILE_MODIFY_TOOLS = ["Write", "Edit"];

/**
 * Map storing pre-tool states indexed by tool_use_id
 */
const preToolStates = new Map<string, PreToolState>();

/**
 * Map storing completed diff records indexed by tool_use_id
 */
const diffRecords = new Map<string, DiffRecord>();

/**
 * Read file content safely
 *
 * @param filePath - Path to the file to read
 * @returns File content or null if file doesn't exist or is too large
 */
async function readFileContent(filePath: string): Promise<string | null> {
  try {
    const fs = await import("fs/promises");

    // Check file stats first
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        logWarn(`[DiffTracker] File too large to track: ${filePath} (${stats.size} bytes)`);
        return null;
      }
    } catch {
      // File doesn't exist yet
      return null;
    }

    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * Compute a unified diff between two strings
 *
 * Uses a simple line-by-line diff algorithm that produces
 * unified diff format output.
 *
 * @param original - Original content (or empty string if null)
 * @param modified - Modified content (or empty string if null)
 * @param filePath - Path to the file (for diff header)
 * @returns Unified diff string
 */
function computeUnifiedDiff(
  original: string | null,
  modified: string | null,
  filePath: string
): string {
  const originalLines = (original || "").split("\n");
  const modifiedLines = (modified || "").split("\n");

  const diffLines: string[] = [];

  // Add diff header
  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);

  // Simple line-by-line diff
  // For a more sophisticated diff, we would use a proper diff algorithm
  // This is a basic implementation that shows context around changes

  const maxLines = Math.max(originalLines.length, modifiedLines.length);
  let inHunk = false;
  let hunkOriginalStart = 0;
  let hunkModifiedStart = 0;
  let hunkLines: string[] = [];
  let originalLineCount = 0;
  let modifiedLineCount = 0;

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      // Add hunk header
      const origRange =
        originalLineCount === 1
          ? `${hunkOriginalStart + 1}`
          : `${hunkOriginalStart + 1},${originalLineCount}`;
      const modRange =
        modifiedLineCount === 1
          ? `${hunkModifiedStart + 1}`
          : `${hunkModifiedStart + 1},${modifiedLineCount}`;
      diffLines.push(`@@ -${origRange} +${modRange} @@`);
      diffLines.push(...hunkLines);
      hunkLines = [];
      originalLineCount = 0;
      modifiedLineCount = 0;
    }
    inHunk = false;
  };

  let contextLines: string[] = [];
  const CONTEXT_SIZE = 3;

  for (let i = 0; i < maxLines; i++) {
    const origLine = i < originalLines.length ? originalLines[i] : undefined;
    const modLine = i < modifiedLines.length ? modifiedLines[i] : undefined;

    if (origLine === modLine) {
      // Lines are the same
      if (inHunk) {
        contextLines.push(` ${origLine || ""}`);
        if (contextLines.length > CONTEXT_SIZE) {
          // Flush hunk if we have too much trailing context
          flushHunk();
          contextLines = [];
        }
      }
    } else {
      // Lines differ
      if (!inHunk) {
        // Start new hunk
        inHunk = true;
        hunkOriginalStart = Math.max(0, i - CONTEXT_SIZE);
        hunkModifiedStart = Math.max(0, i - CONTEXT_SIZE);

        // Add leading context
        for (let j = Math.max(0, i - CONTEXT_SIZE); j < i; j++) {
          const ctxLine = j < originalLines.length ? originalLines[j] : "";
          hunkLines.push(` ${ctxLine}`);
          originalLineCount++;
          modifiedLineCount++;
        }
      } else if (contextLines.length > 0) {
        // Add accumulated context lines
        hunkLines.push(...contextLines);
        originalLineCount += contextLines.length;
        modifiedLineCount += contextLines.length;
        contextLines = [];
      }

      // Add diff lines
      if (origLine !== undefined) {
        hunkLines.push(`-${origLine}`);
        originalLineCount++;
      }
      if (modLine !== undefined) {
        hunkLines.push(`+${modLine}`);
        modifiedLineCount++;
      }
    }
  }

  // Flush any remaining hunk
  if (contextLines.length > 0 && hunkLines.length > 0) {
    // Add trailing context (up to CONTEXT_SIZE)
    const trailingContext = contextLines.slice(0, CONTEXT_SIZE);
    hunkLines.push(...trailingContext);
    originalLineCount += trailingContext.length;
    modifiedLineCount += trailingContext.length;
  }
  flushHunk();

  // If no differences found
  if (diffLines.length === 2) {
    return ""; // Only headers, no actual diff
  }

  return diffLines.join("\n");
}

/**
 * Capture the state of a file before a tool modifies it
 *
 * Should be called before Write or Edit operations execute.
 *
 * @param toolUseId - Unique identifier for this tool invocation
 * @param toolName - Name of the tool (Write, Edit, etc.)
 * @param input - Tool input containing file path
 */
export async function capturePreToolState(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<void> {
  // Only track file modification tools
  if (!FILE_MODIFY_TOOLS.includes(toolName)) {
    return;
  }

  // Extract file path from input
  const filePath =
    (input.file_path as string) || (input.filePath as string) || (input.path as string);

  if (!filePath) {
    logWarn(`[DiffTracker] No file path found in tool input for ${toolName}`);
    return;
  }

  logInfo(`[DiffTracker] Capturing pre-tool state for ${toolName}: ${filePath}`);

  // Read current file content
  const originalContent = await readFileContent(filePath);

  // Store the pre-tool state
  preToolStates.set(toolUseId, {
    toolName,
    filePath,
    originalContent,
    timestamp: Date.now(),
  });
}

/**
 * Capture the state of a file after a tool modifies it and compute the diff
 *
 * Should be called after Write or Edit operations complete.
 *
 * @param toolUseId - Unique identifier for this tool invocation
 * @param toolName - Name of the tool (Write, Edit, etc.)
 * @returns The computed unified diff, or null if not applicable
 */
export async function capturePostToolState(
  toolUseId: string,
  toolName: string
): Promise<string | null> {
  // Get the pre-tool state
  const preState = preToolStates.get(toolUseId);
  if (!preState) {
    logWarn(`[DiffTracker] No pre-tool state found for ${toolUseId}`);
    return null;
  }

  logInfo(`[DiffTracker] Capturing post-tool state for ${toolName}: ${preState.filePath}`);

  // Read the new file content
  const newContent = await readFileContent(preState.filePath);

  // Compute the diff
  const diff = computeUnifiedDiff(preState.originalContent, newContent, preState.filePath);

  // Store the complete record
  const record: DiffRecord = {
    toolName: preState.toolName,
    filePath: preState.filePath,
    originalContent: preState.originalContent,
    newContent,
    diff: diff || null,
    timestamp: preState.timestamp,
  };

  diffRecords.set(toolUseId, record);

  // Clean up pre-tool state
  preToolStates.delete(toolUseId);

  logInfo(`[DiffTracker] Diff computed for ${preState.filePath}: ${diff ? diff.length : 0} chars`);

  return diff || null;
}

/**
 * Get the diff for a specific tool invocation
 *
 * @param toolUseId - Unique identifier for the tool invocation
 * @returns The unified diff string, or null if not found
 */
export function getDiff(toolUseId: string): string | null {
  const record = diffRecords.get(toolUseId);
  return record?.diff || null;
}

/**
 * Get the complete diff record for a tool invocation
 *
 * @param toolUseId - Unique identifier for the tool invocation
 * @returns The complete diff record, or null if not found
 */
export function getDiffRecord(toolUseId: string): DiffRecord | null {
  return diffRecords.get(toolUseId) || null;
}

/**
 * Clear all tracked diffs
 *
 * Should be called when starting a new session or when diffs
 * are no longer needed.
 */
export function clearDiffs(): void {
  preToolStates.clear();
  diffRecords.clear();
  logInfo("[DiffTracker] All diffs cleared");
}

/**
 * Get the number of tracked diffs
 *
 * @returns Count of diff records
 */
export function getDiffCount(): number {
  return diffRecords.size;
}

/**
 * Get all diff records
 *
 * @returns Array of all diff records
 */
export function getAllDiffRecords(): DiffRecord[] {
  return Array.from(diffRecords.values());
}

/**
 * Create diff tracking hooks for Claude Code tool execution
 *
 * Returns pre and post tool hooks that automatically capture
 * file states and compute diffs.
 *
 * @returns Object containing preToolUse and postToolUse hook functions
 */
export function createDiffTrackingHooks() {
  /**
   * Pre-tool hook to capture file state before modification
   */
  async function preToolUse(
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<void> {
    await capturePreToolState(toolUseId, toolName, input);
  }

  /**
   * Post-tool hook to capture file state after modification
   */
  async function postToolUse(toolUseId: string, toolName: string): Promise<string | null> {
    return capturePostToolState(toolUseId, toolName);
  }

  return {
    preToolUse,
    postToolUse,
  };
}
