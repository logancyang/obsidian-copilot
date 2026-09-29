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
  onProgress?: (progress: ManagedInstallProgress) => void;
}

export type ManagedBinaryPipelineOptions<TOptions> = TOptions & {
  signal: AbortSignal;
  progress: InstallProgressReporter;
};

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
    if (state.kind === "error" && state.operation === "install")
      return { kind: "error", message: state.message };
    return IDLE_ACTION_STATE;
  };

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
    if (!this.operation) return;
    this.publishState({ kind: "installing", progress });
  }

  protected async runExclusive<T>(
    running: ManagedInstallRuntimeState,
    body: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
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
        this.publishState({ kind: "idle" });
      } else {
        this.publishState({
          operation: running.kind === "installing" ? "install" : "configure",
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  async autoUpgrade(
    pin: string,
    minimumVersion: string,
    notify: (message: string) => void
  ): Promise<void> {
    assertBinaryCompatible(
      { kind: "installed", version: pin, source: "managed" },
      minimumVersion,
      this.displayName
    );
    const selected = this.readBinarySettings();
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

  async install(options: TOptions = {} as TOptions): Promise<InstalledBinary> {
    return this.runExclusive({ kind: "installing", progress: null }, (signal) =>
      this.runInstallPipeline(signal, options)
    );
  }

  protected reclaimableDirs(): string[] {
    return [this.getDataDir()];
  }

  async downloadsSize(): Promise<number> {
    const sizes = await Promise.all(this.reclaimableDirs().map(dirSize));
    return sizes.reduce((total, size) => total + size, 0);
  }

  async uninstall(): Promise<void> {
    return this.runExclusive({ kind: "busy" }, async () => {
      await this.removeManagedDownloads();
      if (this.readBinarySettings().binarySource !== "custom") this.clearBinarySettings();
    });
  }

  async setCustomBinaryPath(binaryPath: string | null): Promise<void> {
    return this.runExclusive({ kind: "busy" }, () => this.writeCustomBinaryPath(binaryPath));
  }

  protected async writeCustomBinaryPath(binaryPath: string | null): Promise<void> {
    if (binaryPath === null) {
      this.clearBinarySettings();
      return;
    }
    const error = await validateExecutableFile(binaryPath);
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}
