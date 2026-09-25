import { assertBinaryCompatible } from "./binaryCompatibility";
import {
  InstallProgressReporter,
  type ManagedInstallProgress,
} from "@/agentMode/backends/shared/installProgress";
import {
  ManagedInstallAbortError,
  ManagedInstallOperationInFlightError,
  type ManagedInstallRuntimeState,
} from "@/agentMode/backends/shared/managedInstall";
import type { ManagedInstallActionState } from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { validateExecutableFile } from "@/utils/detectBinary";

// Offline reloads retry at most daily; this file is local to the managed runtime directory.
const AUTOMATIC_UPDATE_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const IDLE_ACTION_STATE: ManagedInstallActionState = Object.freeze({ kind: "idle" });

export interface BinarySettings {
  binaryPath?: string;
  binaryVersion?: string;
  binarySource?: "managed" | "custom";
}

export interface InstalledBinary {
  version: string;
  path: string;
}

export interface ManagedBinaryInstallOptions {
  /** Receives progress in addition to the manager's shared runtime state. */
  onProgress?: (progress: ManagedInstallProgress) => void;
}

/** What a backend's install pipeline receives from the manager that runs it. */
export type ManagedBinaryPipelineOptions<TOptions> = TOptions & {
  signal: AbortSignal;
  progress: InstallProgressReporter;
};

/**
 * Coordinates installation, custom selection, and removal under one process-local
 * write lock. Backends own package acquisition, version validation, and settings.
 */
export abstract class ManagedBinaryManager<
  TOptions extends ManagedBinaryInstallOptions = ManagedBinaryInstallOptions,
> {
  private automaticSelection: BinarySettings | null = null;
  private operation: AbortController | null = null;
  private runtimeState: ManagedInstallRuntimeState = { kind: "idle" };
  private readonly subscribers = new Set<() => void>();

  constructor(private readonly displayName: string) {}

  readonly subscribeRuntimeState = (onChange: () => void): (() => void) => {
    this.subscribers.add(onChange);
    return () => {
      this.subscribers.delete(onChange);
    };
  };

  readonly getRuntimeState = (): ManagedInstallRuntimeState => this.runtimeState;

  private publishState(next: ManagedInstallRuntimeState): void {
    this.runtimeState = next;
    this.subscribers.forEach((notify) => notify());
  }

  /** Projects the shared runtime state onto the install action every setup surface renders. */
  readonly getActionState = (): ManagedInstallActionState => {
    const state = this.getRuntimeState();
    if (state.kind === "installing") {
      return {
        kind: "running",
        label: state.progress?.label ?? "Starting…",
        percent: state.progress?.percent ?? 0,
      };
    }
    // Path validation holds the same lock; other windows must not start a competing update.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (state.kind === "busy" || state.kind === "detecting")
      return { kind: "running", label: "Configuring…" };
    // Retry installs only, never a failed custom-path selection.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (state.kind === "error" && state.operation === "install")
      return { kind: "error", message: state.message };
    return IDLE_ACTION_STATE;
  };

  /** Clears a completed failure when a new plugin lifecycle adopts this manager. */
  forgetSettledError(): void {
    // A reopened lifecycle must adopt an active run instead of clearing its progress.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (this.operation || this.runtimeState.kind !== "error") return;
    this.publishState({ kind: "idle" });
  }

  isBusy(): boolean {
    return this.operation !== null;
  }

  cancelCurrentOperation(): void {
    this.operation?.abort();
  }

  private publishProgress(progress: ManagedInstallProgress): void {
    // Late progress must not return a completed installation to the running state.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (!this.operation) return;
    this.publishState({ kind: "installing", progress });
  }

  protected async runExclusive<T>(
    running: ManagedInstallRuntimeState,
    body: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    // Reject a competing writer while every surface observes the active run.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (this.operation) throw new ManagedInstallOperationInFlightError(this.displayName);
    const controller = new AbortController();
    this.operation = controller;
    this.publishState(running);
    try {
      const result = await body(controller.signal);
      this.operation = null;
      this.publishState({ kind: "idle" });
      return result;
    } catch (error) {
      this.operation = null;
      if (
        error instanceof ManagedInstallAbortError ||
        (error as Error | undefined)?.name === "AbortError"
      ) {
        // Cancellation should not leave subscribed surfaces asking for Retry.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
        this.publishState({ kind: "idle" });
      } else {
        this.publishState({
          // A failed path selection must not offer an install Retry in other windows.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
          operation: running.kind === "installing" ? "install" : "configure",
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  /**
   * Updates an existing Copilot-managed installation to this plugin release's
   * chosen agent version before startup. Retains the previous files
   * and leaves the selection unchanged if installation fails.
   * Recent failures delay another attempt on this device unless the target or
   * minimum supported version changes. Throws if the target version is unsupported.
   *
   * @param pin - Agent version chosen for this plugin release, which may be older than the installed version.
   * @param minimumVersion - Oldest stable agent version this plugin release supports.
   * @param notify - Receives one success or failure message after an attempted installation.
   */
  async autoUpgrade(
    pin: string,
    minimumVersion: string,
    notify: (message: string) => void
  ): Promise<void> {
    // A misconfigured release must not install an agent version that Copilot cannot run.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/535
    assertBinaryCompatible(
      { kind: "installed", version: pin, source: "managed" },
      minimumVersion,
      this.displayName
    );
    const selected = this.readBinarySettings();
    // Custom selections and first installs require explicit user intent.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/530
    if (
      this.isBusy() ||
      selected.binarySource !== "managed" ||
      !selected.binaryPath ||
      !selected.binaryVersion ||
      selected.binaryVersion === pin
    )
      return;
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const path = requireNodeModule<typeof import("node:path")>("path");
    if (!fs.existsSync(selected.binaryPath)) return;
    const failurePath = path.join(this.getDataDir(), "auto-upgrade-failure.json");
    let attempted = false;
    try {
      await this.runExclusive({ kind: "installing", progress: null }, async (signal) => {
        let failure: { pin?: string; minimumVersion?: string; failedAt?: number } = {};
        try {
          failure = JSON.parse(await fs.promises.readFile(failurePath, "utf8"));
        } catch {
          /* First attempt or invalid local metadata. */
        }
        // A failed network request must not repeat on every reload; a changed pin can retry immediately.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/530
        if (
          failure?.pin === pin &&
          // A changed minimum version or a failure record without one must not delay recovery.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/535
          failure.minimumVersion === minimumVersion &&
          typeof failure.failedAt === "number" &&
          failure.failedAt <= Date.now() &&
          Date.now() - failure.failedAt < AUTOMATIC_UPDATE_RETRY_DELAY_MS
        )
          return;
        if (signal.aborted) return;
        this.automaticSelection = selected;
        this.assertAutomaticSelection();
        attempted = true;
        try {
          await this.runInstallPipeline(signal, {} as TOptions);
          await fs.promises
            .rm(failurePath, { force: true })
            .catch((error) => logWarn(`[AgentMode] Could not clear update cooldown: ${error}`));
        } catch (error) {
          try {
            await fs.promises.mkdir(this.getDataDir(), { recursive: true });
            await fs.promises.writeFile(
              failurePath,
              JSON.stringify({ pin, minimumVersion, failedAt: Date.now() })
            );
          } catch (writeError) {
            logWarn(`[AgentMode] Could not save update cooldown: ${writeError}`);
          }
          throw error;
        } finally {
          this.automaticSelection = null;
        }
      });
      if (attempted) notify(`${this.displayName} updated to ${pin}.`);
    } catch (error) {
      if (!attempted) return;
      logWarn(`[AgentMode] Automatic ${this.displayName} update failed: ${error}`);
      notify(
        `${this.displayName} could not update. Your runtime selection was kept; retry from Configure.`
      );
    } finally {
      this.automaticSelection = null;
    }
  }

  private assertAutomaticSelection(): void {
    const previous = this.automaticSelection;
    const current = this.readBinarySettings();
    // Settings can change outside the manager lock (sync or another plugin lifecycle).
    // Never replace a selection made while the download was running.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/530
    if (
      previous &&
      (current.binaryPath !== previous.binaryPath ||
        current.binaryVersion !== previous.binaryVersion ||
        current.binarySource !== previous.binarySource)
    )
      throw new ManagedInstallAbortError();
  }

  protected selectInstalledBinary(settings: BinarySettings): void {
    this.assertAutomaticSelection();
    this.updateBinarySettings(settings);
  }

  abstract getDataDir(): string;
  protected abstract readBinarySettings(): BinarySettings;
  protected abstract updateBinarySettings(settings: BinarySettings): void;
  protected abstract validateCustomBinary(binaryPath: string): Promise<InstalledBinary>;
  protected abstract installPipeline(
    options: ManagedBinaryPipelineOptions<TOptions>
  ): Promise<InstalledBinary>;

  /**
   * Runs the backend's install pipeline with shared progress reporting. The
   * caller must hold the operation lock.
   * @param signal - Cancels the running operation.
   * @param options - Backend installation options and an optional progress observer.
   */
  protected async runInstallPipeline(
    signal: AbortSignal,
    options: TOptions
  ): Promise<InstalledBinary> {
    const progress = new InstallProgressReporter(this.displayName, (update) => {
      // Some requests cannot be aborted, so a cancelled install can keep running and must look stopped.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/578
      if (signal.aborted) return;
      this.publishProgress(update);
      options.onProgress?.(update);
    });
    try {
      return await this.installPipeline({ ...options, signal, progress });
    } finally {
      progress.dispose();
    }
  }

  /**
   * Installs the backend package while preventing competing binary selection or removal.
   * @param options - Backend installation options and an optional progress observer.
   */
  async install(options: TOptions = {} as TOptions): Promise<InstalledBinary> {
    return this.runExclusive({ kind: "installing", progress: null }, (signal) =>
      this.runInstallPipeline(signal, options)
    );
  }

  protected reclaimableDirs(): string[] {
    return [this.getDataDir()];
  }

  /** Total disk space reclaimed by uninstall, including backend-owned legacy installs. */
  async downloadsSize(): Promise<number> {
    const sizes = await Promise.all(this.reclaimableDirs().map(dirSize));
    return sizes.reduce((total, size) => total + size, 0);
  }

  /** Removes managed downloads and preserves a user-selected custom installation. */
  async uninstall(): Promise<void> {
    return this.runExclusive({ kind: "busy" }, async () => {
      await this.removeManagedDownloads();
      // Custom executables belong to the user; removing downloads must not disconnect them.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (this.readBinarySettings().binarySource !== "custom") this.clearBinarySettings();
    });
  }

  /**
   * Validates and selects a custom executable, then removes unused managed downloads.
   * @param binaryPath - Executable to select, or null to clear the configured selection.
   */
  async setCustomBinaryPath(binaryPath: string | null): Promise<void> {
    return this.runExclusive({ kind: "busy" }, () => this.writeCustomBinaryPath(binaryPath));
  }

  protected async writeCustomBinaryPath(binaryPath: string | null): Promise<void> {
    // Clearing a selection must leave both user-owned files and downloaded versions intact.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (binaryPath === null) {
      this.clearBinarySettings();
      return;
    }
    const error = await validateExecutableFile(binaryPath);
    // Catch invalid paths before persisting a configuration that cannot launch.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (error) throw new Error(error);
    const installed = await this.validateCustomBinary(binaryPath);
    this.updateBinarySettings({
      binaryPath: installed.path,
      binaryVersion: installed.version,
      binarySource: "custom",
    });
    try {
      await this.removeManagedDownloads();
    } catch (error) {
      // Keep the validated selection usable even when reclaiming disk space fails.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      throw new Error(
        `Your own binary is now in use, but Copilot could not remove its managed downloads: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async removeManagedDownloads(): Promise<void> {
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const settings = this.readBinarySettings();
    const customPath = settings.binarySource === "custom" ? settings.binaryPath : undefined;
    for (const dir of this.reclaimableDirs()) {
      if (customPath) {
        // A managed executable selected as custom (including through a symlink) must
        // remain usable; its containing download cannot be reclaimed.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
        const [realDir, realCustomPath] = await Promise.all([
          realPathOrMissing(dir),
          realPathOrMissing(customPath),
        ]);
        const relativePaths = [
          path.relative(dir, customPath),
          path.relative(realDir, realCustomPath),
        ];
        if (
          relativePaths.some(
            (relative) =>
              relative === "" ||
              (!path.isAbsolute(relative) &&
                relative !== ".." &&
                !relative.startsWith(`..${path.sep}`))
          )
        )
          continue;
      }
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }

  protected clearBinarySettings(): void {
    this.updateBinarySettings({
      binaryPath: undefined,
      binaryVersion: undefined,
      binarySource: undefined,
    });
  }
}

async function dirSize(dir: string): Promise<number> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      total += await fs.promises.stat(full).then(
        (stat) => stat.size,
        () => 0
      );
    }
  }
  return total;
}

async function realPathOrMissing(filePath: string): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  try {
    return await fs.promises.realpath(filePath);
  } catch (error) {
    // Missing downloads and stale custom paths are normal during uninstall.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}
