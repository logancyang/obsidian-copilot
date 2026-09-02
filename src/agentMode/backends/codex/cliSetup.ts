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

export const CODEX_INSTALL_COMMAND =
  "npm uninstall -g @zed-industries/codex-acp; npm install -g @agentclientprotocol/codex-acp";

/**
 * Sign in through the bundled CLI because the dedicated login command requires
 * a separate `codex` on PATH: https://github.com/agentclientprotocol/codex-acp/issues/459
 */
export const CODEX_AUTH_COMMAND = "codex-acp cli login";
