export const ANTIGRAVITY_BINARY_NAME = "antigravity-acp";

export function antigravityBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32" ? "C:\\path\\to\\antigravity-acp.exe" : "/path/to/antigravity-acp";
}

export const ANTIGRAVITY_INSTALL_COMMAND = "npm install -g antigravity-acp";
export const ANTIGRAVITY_AUTH_COMMAND = "agy auth";
