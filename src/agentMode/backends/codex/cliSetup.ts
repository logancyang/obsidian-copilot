/**
 * What the Configure dialog and the descriptor both need to talk about the
 * Codex CLI: the adapter's binary name, path example, and the two commands that
 * get a machine from "no Codex" to "signed in". Kept out of `descriptor.ts` so
 * the dialog can render them without dragging every descriptor dependency into
 * its module graph.
 */

export const CODEX_BINARY_NAME = "codex-acp";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

const CODEX_WINDOWS_INSTALL_COMMAND =
  "irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/ca3aa97df262a8b30b64818dcb19062a582e5e09/docs/install-codex-agent-mode-windows.ps1 | iex";

export function codexInstallCommand(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? CODEX_WINDOWS_INSTALL_COMMAND
    : "npm install -g @agentclientprotocol/codex-acp";
}

export const CODEX_INSTALL_COMMAND = codexInstallCommand(process.platform);

/** Sign-in the `codex` CLI owns end to end; Copilot only inherits the credentials it stores. */
export const CODEX_AUTH_COMMAND = "codex login";
