import { z } from "zod";
import {
  runDailyReadCommand,
  runRandomReadCommand,
} from "@/services/obsidianCli/ObsidianCliClient";
import { formatCliFailureMessage } from "@/services/obsidianCli/cliErrors";
import { createLangChainTool } from "./createLangChainTool";

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
      content: result.stdout,
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
      content: result.stdout,
      durationMs: result.durationMs,
    };
  },
});
