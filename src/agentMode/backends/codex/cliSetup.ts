export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_ACP_PINNED_VERSION = "1.10.0";
export const CODEX_PACKAGING_REVISION = 1;
export const CODEX_BUNDLE_VERSION = `${CODEX_ACP_PINNED_VERSION}-r${CODEX_PACKAGING_REVISION}`;

export function codexBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
    : "/absolute/path/to/codex-acp";
}
