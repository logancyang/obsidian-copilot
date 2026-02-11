import { z } from "zod";
import {
  runDailyReadCommand,
  runRandomReadCommand,
} from "@/services/obsidianCli/ObsidianCliClient";
import { createLangChainTool } from "./createLangChainTool";

/**
 * Build a readable error string from CLI process output.
 *
 * @param stderr - Standard error payload.
 * @param exitCode - Numeric process exit code when available.
 * @param errorCode - Process error code from runtime.
 * @returns User-facing error summary.
 */
function formatCliFailureMessage(
  stderr: string,
  exitCode: number | null,
  errorCode: string | number | null,
  attemptedBinaries: string[]
): string {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return trimmedStderr;
  }

  if (errorCode === "ENOENT") {
    const attempted = attemptedBinaries.length > 0 ? attemptedBinaries.join(", ") : "unknown";
    return `CLI binary not found. Tried: ${attempted}. Ensure Obsidian CLI is installed or set OBSIDIAN_CLI_BINARY/OBSIDIAN_CLI_PATH.`;
  }

  if (errorCode !== null) {
    return `Obsidian CLI failed with error code ${String(errorCode)}`;
  }

  if (exitCode !== null) {
    return `Obsidian CLI failed with exit code ${exitCode}`;
  }

  return "Obsidian CLI read command failed for an unknown reason";
}

/**
 * Tool that reads today's daily note via the official Obsidian CLI (`daily:read`).
 */
export const obsidianDailyReadTool = createLangChainTool({
  name: "obsidianDailyRead",
  description:
    "Read the current daily note via Obsidian CLI and return the note content as plain text.",
  schema: z.object({
    vault: z
      .string()
      .optional()
      .describe(
        "Optional vault name to target. Omit to use the active/default vault resolution from Obsidian CLI."
      ),
  }),
  func: async ({ vault }) => {
    const result = await runDailyReadCommand(vault);

    if (!result.ok) {
      throw new Error(
        `Failed to read daily note via Obsidian CLI: ${formatCliFailureMessage(
          result.stderr,
          result.exitCode,
          result.errorCode,
          result.attemptedBinaries
        )}`
      );
    }

    return {
      type: "obsidian_cli_daily_read",
      command: result.command,
      vault: vault || null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});

/**
 * Tool that reads a random note via the official Obsidian CLI (`random:read`).
 */
export const obsidianRandomReadTool = createLangChainTool({
  name: "obsidianRandomRead",
  description: "Read a random note via Obsidian CLI and return the note content as plain text.",
  schema: z.object({
    vault: z
      .string()
      .optional()
      .describe(
        "Optional vault name to target. Omit to use the active/default vault resolution from Obsidian CLI."
      ),
  }),
  func: async ({ vault }) => {
    const result = await runRandomReadCommand(vault);

    if (!result.ok) {
      throw new Error(
        `Failed to read random note via Obsidian CLI: ${formatCliFailureMessage(
          result.stderr,
          result.exitCode,
          result.errorCode,
          result.attemptedBinaries
        )}`
      );
    }

    return {
      type: "obsidian_cli_random_read",
      command: result.command,
      vault: vault || null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});
