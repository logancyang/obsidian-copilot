import type { ManagedInstallProgress } from "@/agentMode/backends/shared/installProgress";
import { renameWithRetry } from "@/agentMode/skills/renameWithRetry";
import { logError, logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

export type ManagedInstallRuntimeState =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; progress: ManagedInstallProgress | null }
  | { kind: "busy" }
  | { kind: "error"; message: string; operation: "install" | "configure" };

export class ManagedInstallOperationInFlightError extends Error {
  constructor(displayName: string) {
    super(`A ${displayName} setup operation is already running.`);
    this.name = "ManagedInstallOperationInFlightError";
  }
}

export class ManagedInstallAbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}

export async function promoteManagedVersion(
  stageDir: string,
  versionDir: string,
  displayName: string
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const randomBytes = requireNodeModule<typeof import("node:crypto")>("crypto").randomBytes;
  let asideDir: string | null = null;
  try {
    await fs.promises.access(versionDir);
    asideDir = `${versionDir}.old-${randomBytes(4).toString("hex")}`;
    await renameWithRetry(versionDir, asideDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await renameWithRetry(stageDir, versionDir);
  } catch (error) {
    if (asideDir) {
      await renameWithRetry(asideDir, versionDir).catch((restoreError) =>
        logError(`[AgentMode] failed to restore previous ${displayName} install`, restoreError)
      );
    }
    throw error;
  }

  if (asideDir) {
    await fs.promises
      .rm(asideDir, { recursive: true, force: true })
      .catch((error) => logWarn(`[AgentMode] failed to remove ${asideDir}: ${error}`));
  }
}
