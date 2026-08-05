/**
 * What the Configure dialog and the descriptor both need to talk about the
 * Codex CLI: the adapter's binary name, path example, and the two commands that
 * get a machine from "no Codex" to "signed in". Kept out of `descriptor.ts` so
 * the dialog can render them without dragging every descriptor dependency into
 * its module graph.
 */

export const CODEX_BINARY_NAME = "codex-acp";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32" ? "/absolute/path/to/codex-acp.exe" : "/absolute/path/to/codex-acp";
}

export const CODEX_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://gist.githubusercontent.com/logancyang/380ef4dbf9f98900771da76eca3d21e6/raw/install-codex-agent-mode-windows.ps1 | iex"
    : "npm install -g @agentclientprotocol/codex-acp";

/** Sign-in the `codex` CLI owns end to end; Copilot only inherits the credentials it stores. */
export const CODEX_AUTH_COMMAND = "codex login";
