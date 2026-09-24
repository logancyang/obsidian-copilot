import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
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
import { formatBytes } from "@/utils/formatBytes";
import { getSettings, updateAgentModeBackendFields } from "@/settings/model";
import { resolveSupportedCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";

import { installCodexArchive, CODEX_PINNED_VERSION } from "./codexArchive";

const IDLE_ACTION_STATE = Object.freeze({ kind: "idle" as const });
const TIMEOUT_MS = 5 * 60_000;
const EMPTY_BINARY_SETTINGS: BinarySettings = Object.freeze({});

interface CodexInstallProgress {
  label: string;
  percent: number;
}

/** Owns the native Codex bundle installation; shared lifecycle operations never modify user-owned packages. */
export class CodexBinaryManager extends ManagedBinaryManager<CodexInstallProgress> {
  constructor() {
    super("Codex adapter");
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
    // Manual retries must not replace a working selection with an unsupported release pin. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
    assertBinaryCompatible(
      { kind: "installed", version: CODEX_PINNED_VERSION, source: "managed" },
      CODEX_MIN_VERSION,
      "Codex adapter"
    );
    const dataDir = this.getDataDir();
    const versionDir = path().join(dataDir, CODEX_PINNED_VERSION);
    const stageDir = path().join(dataDir, `.tmp-${CODEX_PINNED_VERSION}-${Date.now()}`);
    await fs().promises.mkdir(stageDir, { recursive: true });
    try {
      onProgress?.({ label: "Connecting to Codex download…", percent: 5 });
      await installCodexArchive(stageDir, signal, (progress) => {
        // Download bytes are measurable; later phases name work whose duration varies by device.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/578
        if (progress.phase === "download") {
          onProgress?.({
            label: `Downloading Codex adapter — ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`,
            percent: 10 + Math.floor((progress.received / progress.total) * 65),
          });
        } else onProgress?.({ label: "Extracting Codex adapter…", percent: 80 });
      });
      onProgress?.({ label: "Verifying Codex adapter…", percent: 87 });
      const stagedEntry = entryPath(stageDir);
      await verifyLauncher(stagedEntry, signal);
      // A runnable adapter alone does not prove its bundled native runtime survived extraction.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      onProgress?.({ label: "Verifying bundled Codex runtime…", percent: 93 });
      const runtime = await run(stagedEntry, ["cli", "--help"], signal);
      if (!runtime.includes("Codex CLI"))
        throw new Error("The bundled Codex runtime could not start.");
      // Cancellation during verification must not replace the working installation.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (signal.aborted) throw new ManagedInstallAbortError();
      onProgress?.({ label: "Activating Codex adapter…", percent: 98 });
      await promoteManagedVersion(stageDir, versionDir, "Codex adapter");
      const finalEntry = entryPath(versionDir);
      this.selectInstalledBinary({
        binaryPath: finalEntry,
        binaryVersion: CODEX_PINNED_VERSION,
        binarySource: "managed",
      });
      onProgress?.({ label: "Codex adapter ready.", percent: 100 });
      return { version: CODEX_PINNED_VERSION, path: finalEntry };
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
  if (!stdout.includes(CODEX_PINNED_VERSION)) {
    throw new Error(`The Codex adapter did not report version ${CODEX_PINNED_VERSION}.`);
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
