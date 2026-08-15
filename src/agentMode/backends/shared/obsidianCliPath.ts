import { requireNodeModule } from "@/utils/desktopRuntime";

export const COPILOT_OBSIDIAN_CLI_ENV = "COPILOT_OBSIDIAN_CLI";

interface ObsidianCliPathInput {
  platform: NodeJS.Platform;
  resourcesPath?: string;
  homeDir: string;
  isExecutable?: (candidate: string) => boolean;
}

/**
 * Resolve the terminal-capable CLI shipped with the running Obsidian install.
 * The GUI executable cannot carry terminal output on Windows, while Linux may
 * use either the current install or its registered per-user copy.
 *
 * @param input - Host platform, Electron resources directory, home directory, and optional executable probe.
 */
export function resolveObsidianCliPath(input: ObsidianCliPathInput): string | null {
  if (!input.resourcesPath) return null;
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathApi = input.platform === "win32" ? path.win32 : path.posix;
  const installDir = pathApi.dirname(input.resourcesPath);
  const candidates =
    input.platform === "win32"
      ? [pathApi.join(installDir, "Obsidian.com").replaceAll("\\", "/")]
      : input.platform === "darwin"
        ? [pathApi.join(installDir, "MacOS", "obsidian-cli")]
        : input.platform === "linux"
          ? [
              pathApi.join(installDir, "obsidian-cli"),
              pathApi.join(input.homeDir, ".local", "bin", "obsidian"),
            ]
          : [];
  const isExecutable =
    input.isExecutable ??
    ((candidate: string): boolean => {
      try {
        const fs = requireNodeModule<typeof import("node:fs")>("fs");
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

  return candidates.find(isExecutable) ?? null;
}
