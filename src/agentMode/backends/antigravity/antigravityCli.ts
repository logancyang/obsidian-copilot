import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";
import type { InstallState } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import {
  ANTIGRAVITY_BINARY_NAME,
  antigravitySearchDirs,
  resolveAntigravityBinary,
  type AntigravityBinaryResolverInput,
} from "./antigravityBinaryResolver";

const READY: InstallState = Object.freeze({ kind: "ready", source: "custom" });
const ABSENT: InstallState = Object.freeze({ kind: "absent" });

export function antigravityInstallState(binaryPath: string | null): InstallState {
  return binaryPath ? READY : ABSENT;
}

function hostResolverInput(override?: string): AntigravityBinaryResolverInput {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  return {
    override,
    homeDir: os.homedir(),
    platform: process.platform,
    fs: { existsSync: (p) => fs.existsSync(p) },
  };
}

export function resolveAntigravityBinaryPath(settings: CopilotSettings): string | null {
  return resolveAntigravityBinary(
    hostResolverInput(settings.agentMode?.backends?.antigravity?.binaryPath)
  );
}

export async function detectAntigravityCliPath(): Promise<string | null> {
  return resolveAntigravityBinary(hostResolverInput()) ?? detectBinary(ANTIGRAVITY_BINARY_NAME);
}

export function antigravityDetectionSearchDirs(): string[] {
  return antigravitySearchDirs(hostResolverInput());
}

export function antigravitySignInCommand(
  binaryPath: string | null,
  envOverrides: Record<string, string> | undefined,
  platform: NodeJS.Platform
): string | null {
  return terminalSignInCommand({
    binaryPath: binaryPath ?? undefined,
    args: ["acp", "--login"],
    profileVariables: [],
    envOverrides,
    platform,
  });
}
