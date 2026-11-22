import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";

export const CLAUDE_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex"
    : "npm install -g @anthropic-ai/claude-code";

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
