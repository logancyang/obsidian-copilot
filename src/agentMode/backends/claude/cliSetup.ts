/**
 * The two commands that get a machine from "no Claude" to "signed in". Kept out
 * of `descriptor.ts` so the Configure dialog can render them without dragging
 * the Claude SDK — and every other descriptor dependency — into its module graph.
 */

export const CLAUDE_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex"
    : "npm install -g @anthropic-ai/claude-code";

/** Sign-in the CLI owns end to end; Copilot only inherits the credentials it stores. */
export const CLAUDE_AUTH_COMMAND = "claude auth login --claudeai";
