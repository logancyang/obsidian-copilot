import type { CompanionBackendId, CompanionBackendSettings } from "@/settings/model";

export interface CompanionDefinition {
  id: CompanionBackendId;
  displayName: string;
  binaryName: string;
  installerBaseUrl: string;
  loginArgs: readonly string[];
  skillsProjectDir: string;
  automaticTools?: boolean;
}

export function companionInvocation(
  command: string,
  args: readonly string[],
  platform: string,
  comspec = "cmd.exe"
) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command)
    ? { command: comspec, args: ["/d", "/c", command, ...args] }
    : { command, args: [...args] };
}

export function companionCompatibility(
  id: CompanionBackendId,
  version: string,
  platform: string
): string | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version);
  if (!match) return "The CLI did not report a recognizable version.";
  const [major, minor, patch] = match.slice(1).map(Number);
  if (
    id === "grok" &&
    platform === "win32" &&
    major === 0 &&
    minor === 2 &&
    patch >= 61 &&
    patch <= 70
  ) {
    return "This Grok Windows version has a broken stdio transport. Update the CLI.";
  }
  if (id === "grok" && major === 0 && (minor < 2 || (minor === 2 && patch < 117))) {
    return "Grok 0.2.117 or newer is required.";
  }
  return null;
}

export function companionModeMapping(
  id: CompanionBackendId,
  modes: readonly { id: string }[] | undefined
) {
  const available = new Set(modes?.map((mode) => mode.id));
  const choose = (...values: string[]) => values.find((value) => available.has(value));
  return {
    kind: "setMode" as const,
    canonical:
      id === "antigravity"
        ? { auto: choose("agent", "yolo"), plan: choose("plan") }
        : id === "muse"
          ? { default: choose("agent", "onRequest"), auto: choose("yolo") }
          : {
              default: choose("default", "agent"),
              auto: choose("yolo", "auto"),
              plan: choose("plan"),
            },
  };
}

export function companionRuntimeConfigKey(config: CompanionBackendSettings | undefined): string {
  return JSON.stringify([
    config?.binaryPath,
    config?.binaryVersion,
    config?.binarySource,
    config?.envOverrides,
    config?.automaticToolsConsent,
  ]);
}
