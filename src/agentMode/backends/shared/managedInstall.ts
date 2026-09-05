import { renameWithRetry } from "@/agentMode/skills/renameWithRetry";
import { logError, logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

export type ManagedInstallRuntimeState<TProgress> =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; progress: TProgress | null }
  | { kind: "busy" }
  | { kind: "error"; message: string };

export interface ManagedInstallRuntime<TProgress> {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): ManagedInstallRuntimeState<TProgress>;
  run<T>(
    running: ManagedInstallRuntimeState<TProgress>,
    body: (signal: AbortSignal) => Promise<T>
  ): Promise<T>;
  publishProgress(progress: TProgress): void;
  forgetSettledError(): void;
  isBusy(): boolean;
  cancel(): void;
}

/** Reports a competing process-local operation without changing the active run. */
export class ManagedInstallOperationInFlightError extends Error {
  constructor(displayName: string) {
    super(`A ${displayName} setup operation is already running.`);
    this.name = "ManagedInstallOperationInFlightError";
  }
}

/** Marks user cancellation so the shared state returns to idle instead of Retry. */
export class ManagedInstallAbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}

export function createManagedInstallRuntime<TProgress>(
  displayName: string
): ManagedInstallRuntime<TProgress> {
  let operation: { controller: AbortController } | null = null;
  let state: ManagedInstallRuntimeState<TProgress> = { kind: "idle" };
  const subscribers = new Set<() => void>();

  const publish = (next: ManagedInstallRuntimeState<TProgress>): void => {
    state = next;
    subscribers.forEach((notify) => notify());
  };

  return {
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },

    getSnapshot: () => state,

    async run<T>(
      running: ManagedInstallRuntimeState<TProgress>,
      body: (signal: AbortSignal) => Promise<T>
    ): Promise<T> {
      // Reject a competing writer while every surface observes the active run.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (operation) throw new ManagedInstallOperationInFlightError(displayName);
      const controller = new AbortController();
      operation = { controller };
      publish(running);
      try {
        const result = await body(controller.signal);
        operation = null;
        publish({ kind: "idle" });
        return result;
      } catch (error) {
        operation = null;
        if (
          error instanceof ManagedInstallAbortError ||
          (error as Error | undefined)?.name === "AbortError"
        ) {
          // Cancellation should not leave subscribed surfaces asking for Retry.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
          publish({ kind: "idle" });
        } else {
          publish({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },

    publishProgress(progress) {
      if (!operation) return;
      publish({ kind: "installing", progress });
    },

    forgetSettledError() {
      if (operation || state.kind !== "error") return;
      publish({ kind: "idle" });
    },

    isBusy: () => operation !== null,
    cancel: () => operation?.controller.abort(),
  };
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
    // A failed update must leave the previously active managed adapter usable.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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
