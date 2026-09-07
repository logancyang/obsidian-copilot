import {
  ManagedBinaryManager,
  type BinarySettings,
  type InstalledBinary,
  type ManagedBinaryInstallOptions,
} from "@/agentMode/backends/shared/ManagedBinaryManager";
import {
  ManagedInstallAbortError,
  promoteManagedVersion,
} from "@/agentMode/backends/shared/managedInstall";
import type { ManagedInstallActionState } from "@/agentMode/session/types";
import { copilotAppDataDir } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { getSettings, updateAgentModeBackendFields } from "@/settings/model";
import { resolveSupportedCodexAcpPackage } from "./codexVersion";
import { CODEX_ACP_PINNED_VERSION } from "./cliSetup";

import { installCodexArchive, CODEX_BUNDLE_VERSION } from "./codexArchive";

const IDLE_ACTION_STATE = Object.freeze({ kind: "idle" as const });
const TIMEOUT_MS = 5 * 60_000;
const EMPTY_BINARY_SETTINGS: BinarySettings = Object.freeze({});
const EMPTY_DIRS: string[] = [];
Object.freeze(EMPTY_DIRS);

interface CodexInstallProgress {
  label: string;
  percent: number;
}

/** Owns the native Codex bundle installation; shared lifecycle operations never modify user-owned packages. */
export class CodexBinaryManager extends ManagedBinaryManager<CodexInstallProgress> {
  private readonly users = new Map<string, number>();

  constructor() {
    super("Codex adapter");
  }

  /**
   * Protects the selected installation until a session or login child exits.
   * @param binaryPath - Executable captured before starting the child.
   */
  reserveBinary(binaryPath: string): () => void {
    // Starting during a write could launch a directory that is about to be removed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
    if (this.isBusy()) throw new Error("Wait for Codex setup to finish before starting Codex.");
    const key = path().resolve(binaryPath);
    this.users.set(key, (this.users.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      // Exit and startup failure may both report the same child.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
      if (released) return;
      released = true;
      const count = this.users.get(key)! - 1;
      if (count === 0) this.users.delete(key);
      else this.users.set(key, count);
    };
  }

  protected reclaimableDirs(): string[] {
    const dataDir = this.getDataDir();
    const settings = getSettings().agentMode.backends?.codex;
    const profile =
      settings?.envOverrides?.CODEX_HOME ??
      process.env.CODEX_HOME ??
      path().join(requireNodeModule<typeof import("node:os")>("os").homedir(), ".codex");
    const custom =
      this.readBinarySettings().binarySource === "custom" ? settings?.binaryPath : undefined;
    // A user can explicitly place their profile or custom executable inside managed storage.
    // Never infer ownership of those files from their parent directory.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
    const protectedPaths = [profile, custom].filter((value): value is string => Boolean(value));
    if (!fs().existsSync(dataDir)) return EMPTY_DIRS;
    return fs()
      .readdirSync(dataDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^(?:\.tmp-)?\d+\.\d+\.\d+-r\d+-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            entry.name
          )
      )
      .map((entry) => path().join(dataDir, entry.name))
      .filter(
        (dir) =>
          !protectedPaths.some((value) => containsPath(dir, value) || containsPath(value, dir))
      );
  }

  async uninstall(): Promise<void> {
    // Running adapters can load their bundled runtime after startup, including on Unix.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
    if (
      this.reclaimableDirs().some((dir) =>
        [...this.users.keys()].some((key) => containsPath(dir, key))
      )
    ) {
      throw new Error("Close Codex sessions and sign-in before uninstalling the managed adapter.");
    }
    await super.uninstall();
  }

  protected readBinarySettings(): BinarySettings {
    const settings = getSettings().agentMode.backends?.codex;
    // Existing custom selections predate source metadata and still belong to the user.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (settings?.binaryPath && !settings.binarySource)
      return { ...settings, binarySource: "custom" };
    return settings ?? EMPTY_BINARY_SETTINGS;
  }

  protected updateBinarySettings(settings: BinarySettings): void {
    updateAgentModeBackendFields("codex", settings);
  }

  protected async validateCustomBinary(binaryPath: string): Promise<InstalledBinary> {
    const supported = resolveSupportedCodexAcpPackage(binaryPath);
    return { version: supported.version, path: supported.entryPath };
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
    // Retry installs only, never a failed custom-path selection.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (state.kind === "error" && state.operation === "install")
      return { kind: "error", message: state.message };
    return IDLE_ACTION_STATE;
  };
  getDataDir(): string {
    const home = requireNodeModule<typeof import("node:os")>("os").homedir();
    if (!home || !path().isAbsolute(home) || path().parse(home).root === home) {
      throw new Error("Could not resolve your home directory for the managed Codex adapter.");
    }
    return path().join(copilotAppDataDir(home), "codex");
  }
  protected async installPipeline({
    signal,
    onProgress,
  }: ManagedBinaryInstallOptions<CodexInstallProgress> & {
    signal: AbortSignal;
  }): Promise<InstalledBinary> {
    const dataDir = this.getDataDir();
    // Vaults share downloads but not process-local reservations. Every install gets a
    // fresh directory so promotion never moves another vault's running adapter.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
    const suffix = requireNodeModule<typeof import("node:crypto")>("crypto").randomUUID();
    const versionDir = path().join(dataDir, `${CODEX_BUNDLE_VERSION}-${suffix}`);
    const stageDir = path().join(dataDir, `.tmp-${CODEX_BUNDLE_VERSION}-${suffix}`);
    await fs().promises.mkdir(stageDir, { recursive: true });
    try {
      onProgress?.({ label: "Installing the Codex adapter…", percent: 30 });
      await installCodexArchive(stageDir, signal);
      onProgress?.({ label: "Verifying the Codex adapter…", percent: 85 });
      const stagedEntry = entryPath(stageDir);
      await verifyLauncher(stagedEntry, signal);
      // A runnable adapter alone does not prove its bundled native runtime survived extraction.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      const runtime = await run(stagedEntry, ["cli", "--help"], signal);
      if (!runtime.includes("Codex CLI"))
        throw new Error("The bundled Codex runtime could not start.");
      // Cancellation during verification must not replace the working installation.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (signal.aborted) throw new ManagedInstallAbortError();
      await promoteManagedVersion(stageDir, versionDir, "Codex adapter");
      const finalEntry = entryPath(versionDir);
      updateAgentModeBackendFields("codex", {
        binaryPath: finalEntry,
        binaryVersion: CODEX_BUNDLE_VERSION,
        binarySource: "managed",
      });
      onProgress?.({ label: "Codex adapter ready.", percent: 100 });
      return { version: CODEX_BUNDLE_VERSION, path: finalEntry };
    } finally {
      await fs()
        .promises.rm(stageDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }
}

function entryPath(versionDir: string): string {
  return path().join(versionDir, process.platform === "win32" ? "codex-acp.exe" : "codex-acp");
}

async function verifyLauncher(entry: string, signal: AbortSignal): Promise<void> {
  const stdout = await run(entry, ["--version"], signal);
  if (!stdout.includes(CODEX_ACP_PINNED_VERSION)) {
    throw new Error(`The Codex adapter did not report version ${CODEX_ACP_PINNED_VERSION}.`);
  }
}

function run(command: string, args: string[], signal: AbortSignal): Promise<string> {
  const childProcess = requireNodeModule<typeof import("node:child_process")>("child_process");
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      command,
      args,
      {
        env: process.env,
        signal,
        timeout: TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
}

function fs(): typeof import("node:fs") {
  return requireNodeModule<typeof import("node:fs")>("fs");
}

function path(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}

function containsPath(directory: string, candidate: string): boolean {
  // Protect both a selected symlink and its target: either can lie inside owned storage.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
  const root = fs().existsSync(directory)
    ? fs().realpathSync(directory)
    : path().resolve(directory);
  const target = fs().existsSync(candidate)
    ? fs().realpathSync(candidate)
    : path().resolve(candidate);
  return [path().relative(directory, candidate), path().relative(root, target)].some(
    (relative) =>
      relative === "" ||
      (!relative.startsWith(`..${path().sep}`) && relative !== ".." && !path().isAbsolute(relative))
  );
}

export const codexBinaryManager = new CodexBinaryManager();
