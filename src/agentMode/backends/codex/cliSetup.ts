/**
 * What the Configure dialog and the descriptor both need to talk about the
 * Codex CLI: the adapter's binary name, path example, and the command that
 * gets a machine signed in. Kept out of `descriptor.ts` so
 * the dialog can render them without dragging every descriptor dependency into
 * its module graph.
 */

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_ACP_PINNED_VERSION = "1.10.0";

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}

/**
 * Sign in through the bundled CLI because the dedicated login command requires
 * a separate `codex` on PATH: https://github.com/agentclientprotocol/codex-acp/issues/459
 */
export const CODEX_AUTH_COMMAND = `npx -y @agentclientprotocol/codex-acp@${CODEX_ACP_PINNED_VERSION} cli login`;
