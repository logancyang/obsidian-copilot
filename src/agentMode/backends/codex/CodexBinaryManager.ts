import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
import {
  ManagedBinaryManager,
  type BinarySettings,
  type InstalledBinary,
  type ManagedBinaryInstallOptions,
  type ManagedBinaryPipelineOptions,
} from "@/agentMode/backends/shared/ManagedBinaryManager";
import {
  ManagedInstallAbortError,
  promoteManagedVersion,
} from "@/agentMode/backends/shared/managedInstall";
import { copilotAppDataDir } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { getSettings, updateAgentModeBackendFields } from "@/settings/model";
import { resolveSupportedCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";

import { installCodexArchive, CODEX_PINNED_VERSION } from "./codexArchive";

const TIMEOUT_MS = 5 * 60_000;
const EMPTY_BINARY_SETTINGS: BinarySettings = Object.freeze({});

/** Owns the native Codex bundle installation; shared lifecycle operations never modify user-owned packages. */
export class CodexBinaryManager extends ManagedBinaryManager {
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

  getDataDir(): string {
    const home = requireNodeModule<typeof import("node:os")>("os").homedir();
    if (!home || !path().isAbsolute(home) || path().parse(home).root === home) {
      throw new Error("Could not resolve your home directory for the managed Codex adapter.");
    }
    return path().join(copilotAppDataDir(home), "codex");
  }
  protected async installPipeline({
    signal,
    progress,
  }: ManagedBinaryPipelineOptions<ManagedBinaryInstallOptions>): Promise<InstalledBinary> {
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
      progress.connecting();
      await installCodexArchive(stageDir, signal, progress);
      progress.verifying();
      const stagedEntry = entryPath(stageDir);
      await verifyLauncher(stagedEntry, signal);
      // A runnable adapter alone does not prove its bundled native runtime survived extraction.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      progress.verifying("bundled Codex runtime");
      const runtime = await run(stagedEntry, ["cli", "--help"], signal);
      if (!runtime.includes("Codex CLI"))
        throw new Error("The bundled Codex runtime could not start.");
      // Cancellation during verification must not replace the working installation.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if (signal.aborted) throw new ManagedInstallAbortError();
      progress.activating();
      await promoteManagedVersion(stageDir, versionDir, "Codex adapter");
      const finalEntry = entryPath(versionDir);
      this.selectInstalledBinary({
        binaryPath: finalEntry,
        binaryVersion: CODEX_PINNED_VERSION,
        binarySource: "managed",
      });
      progress.done();
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
