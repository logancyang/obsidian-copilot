/**
 * Antigravity CLI and ACP adapter constants and setup commands.
 */

export const ANTIGRAVITY_BINARY_NAME = "agy-acp";

export function antigravityBinaryPathPlaceholder(platform: NodeJS.Platform): string {
  return platform === "win32" ? "/absolute/path/to/agy-acp.exe" : "/absolute/path/to/agy-acp";
}

export const ANTIGRAVITY_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/install.sh | bash";

/** Authentication is managed by Google sign-in through the agy CLI. */
export const ANTIGRAVITY_AUTH_COMMAND = "agy";
