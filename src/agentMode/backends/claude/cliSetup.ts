import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";

/**
 * Setup commands for the selected Claude installation. Kept out
 * of `descriptor.ts` so the Configure dialog can render them without dragging
 * the Claude SDK — and every other descriptor dependency — into its module graph.
 */

export const CLAUDE_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex"
    : "npm install -g @anthropic-ai/claude-code";

/**
 * Uses the selected Claude installation and profile for terminal sign-in.
 * @param binaryPath - Configured Claude executable.
 * @param envOverrides - Configured environment, filtered to non-secret profile settings.
 * @param platform - Platform whose terminal will run the command.
 */
export function claudeSignInCommand(
  binaryPath: string | undefined,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform
): string | null {
  return terminalSignInCommand({
    binaryPath,
    args: ["auth", "login", "--claudeai"],
    profileVariables: ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME"],
    envOverrides,
    platform,
  });
}
