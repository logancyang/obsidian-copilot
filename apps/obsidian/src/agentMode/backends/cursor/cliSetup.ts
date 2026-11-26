import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";

export const CURSOR_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : "curl https://cursor.com/install -fsS | bash";

export function cursorSignInCommand(
  binaryPath: string | undefined,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform
): string | null {
  return terminalSignInCommand({
    binaryPath,
    args: ["login"],
    profileVariables: [],
    envOverrides,
    platform,
  });
}
