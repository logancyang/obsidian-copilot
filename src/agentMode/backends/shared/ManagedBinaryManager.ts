import {
  ManagedInstallAbortError,
  ManagedInstallOperationInFlightError,
  type ManagedInstallRuntimeState,
} from "@/agentMode/backends/shared/managedInstall";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { validateExecutableFile } from "@/utils/detectBinary";

export interface BinarySettings {
  binaryPath?: string;
  binaryVersion?: string;
  binarySource?: "managed" | "custom";
}

export interface InstalledBinary {
  version: string;
  path: string;
}

export interface ManagedBinaryInstallOptions<TProgress> {
  onProgress?: (progress: TProgress) => void;
}

/**
 * Coordinates installation, custom selection, and removal under one process-local
 * write lock. Backends own package acquisition, version validation, and settings.
 */
export abstract class ManagedBinaryManager<
  TProgress,
  TOptions extends ManagedBinaryInstallOptions<TProgress> = ManagedBinaryInstallOptions<TProgress>,
> {
  private operation: AbortController | null = null;
  private runtimeState: ManagedInstallRuntimeState<TProgress> = { kind: "idle" };
  private readonly subscribers = new Set<() => void>();

  constructor(private readonly displayName: string) {}

  readonly subscribeRuntimeState = (onChange: () => void): (() => void) => {
    this.subscribers.add(onChange);
    return () => {
      this.subscribers.delete(onChange);
    };
  };

  readonly getRuntimeState = (): ManagedInstallRuntimeState<TProgress> => this.runtimeState;

  private publishState(next: ManagedInstallRuntimeState<TProgress>): void {
    this.runtimeState = next;
    this.subscribers.forEach((notify) => notify());
  }

  /** Clears a completed failure when a new plugin lifecycle adopts this manager. */
  forgetSettledError(): void {
    if (this.operation || this.runtimeState.kind !== "error") return;
    this.publishState({ kind: "idle" });
  }

  isBusy(): boolean {
    return this.operation !== null;
  }

  cancelCurrentOperation(): void {
    this.operation?.abort();
  }

  protected publishProgress(progress: TProgress): void {
    // Late progress must not return a completed installation to the running state.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (!this.operation) return;
    this.publishState({ kind: "installing", progress });
  }

  protected async runExclusive<T>(
    running: ManagedInstallRuntimeState<TProgress>,
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

  abstract getDataDir(): string;
  protected abstract readBinarySettings(): BinarySettings;
  protected abstract updateBinarySettings(settings: BinarySettings): void;
  protected abstract validateCustomBinary(binaryPath: string): Promise<InstalledBinary>;
  protected abstract installPipeline(
    options: TOptions & { signal: AbortSignal }
  ): Promise<InstalledBinary>;

  /**
   * Installs the backend package while preventing competing binary selection or removal.
   * @param options - Backend installation options and an optional progress observer.
   */
  async install(options: TOptions = {} as TOptions): Promise<InstalledBinary> {
    return this.runExclusive({ kind: "installing", progress: null }, (signal) =>
      this.installPipeline({
        ...options,
        signal,
        onProgress: (progress: TProgress) => {
          this.publishProgress(progress);
          options.onProgress?.(progress);
        },
      })
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
      const fs = requireNodeModule<typeof import("node:fs")>("fs");
      await Promise.all(
        this.reclaimableDirs().map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
      );
      // Custom executables belong to the user; removing downloads must not disconnect them.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (this.readBinarySettings().binarySource !== "custom") this.clearBinarySettings();
    });
  }

  /**
   * Validates and selects a custom executable without removing managed downloads.
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
