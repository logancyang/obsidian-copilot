import {
  classifyBinaryInstall,
  assertBinaryCompatible,
} from "@/agentMode/backends/shared/binaryCompatibility";
import { downloadFile } from "@/agentMode/backends/shared/downloadFile";
import {
  ManagedBinaryManager,
  type BinarySettings,
  type InstalledBinary,
  type ManagedBinaryInstallOptions,
  type ManagedBinaryPipelineOptions,
} from "@/agentMode/backends/shared/ManagedBinaryManager";
import { OPENCODE_MIN_VERSION, OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type OpencodeBackendSettings } from "@/settings/model";
import { FileSystemAdapter } from "obsidian";
import { copilotAppDataDir } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { expectedBinaryName, resolveOpencodeTarget } from "./platformResolver";
import { extractNpmBinary, resolveNpmAsset, verifyNpmIntegrity } from "./npmPackage";
import type { InstallState as BackendInstallState } from "@/agentMode/session/types";
import {
  ManagedInstallAbortError,
  ManagedInstallOperationInFlightError,
  promoteManagedVersion,
  type ManagedInstallRuntimeState,
} from "@/agentMode/backends/shared/managedInstall";

function nodeFs(): typeof import("node:fs") {
  return requireNodeModule<typeof import("node:fs")>("fs");
}

function nodePath(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}

async function execFileAsync(
  file: string,
  args: string[],
  options: Pick<import("node:child_process").ExecFileOptions, "timeout" | "windowsHide" | "signal">
): Promise<{ stdout: string | Buffer }> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  const { stdout } = await promisify(execFile)(file, args, options);
  return { stdout };
}
const VERIFY_BINARY_TIMEOUT_MS = 8_000;
const UPGRADE_BINARY_TIMEOUT_MS = 180_000;

export interface InstallOptions extends ManagedBinaryInstallOptions {
  version?: string;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "installed"; version: string; path: string; source: "managed" | "custom" };

export type RuntimeState = ManagedInstallRuntimeState;

export class OperationInFlightError extends ManagedInstallOperationInFlightError {
  constructor() {
    super("opencode");
    this.name = "OperationInFlightError";
  }
}

interface InstallManifest {
  version: string;
  assetName: string;
  installedAt: string;
}

export class AbortError extends ManagedInstallAbortError {
  constructor() {
    super();
    this.name = "AbortError";
  }
}

export function computeInstallState(
  opencode: OpencodeBackendSettings | undefined,
  fileExists: (path: string) => boolean = (p) => nodeFs().existsSync(p)
): InstallState {
  const s = opencode ?? {};
  if (s.binaryPath && fileExists(s.binaryPath)) {
    return {
      kind: "installed",
      // An existing selection without usable metadata needs Configure, not Install. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
      version: s.binaryVersion ?? "",
      path: s.binaryPath,
      source: s.binarySource ?? "managed",
    };
  }
  return { kind: "absent" };
}

function readOpencodeSettings(): OpencodeBackendSettings {
  return getSettings().agentMode?.backends?.opencode ?? {};
}

export function isOpencodeVersionOutdated(version: string | undefined): boolean {
  if (!version) return false;
  return (
    classifyBinaryInstall(
      { kind: "installed", version, source: "managed" },
      OPENCODE_MIN_VERSION,
      "opencode"
    ).kind !== "ready"
  );
}

export function toOpencodeInstallState(state: InstallState): BackendInstallState {
  return classifyBinaryInstall(state, OPENCODE_MIN_VERSION, "opencode");
}

function updateOpencodeFields(partial: Partial<OpencodeBackendSettings>): void {
  setSettings((cur) => ({
    agentMode: {
      ...cur.agentMode,
      backends: {
        ...cur.agentMode.backends,
        opencode: { ...(cur.agentMode.backends?.opencode ?? {}), ...partial },
      },
    },
  }));
}

function clearOpencodeBinary(): void {
  updateOpencodeFields({
    binaryVersion: undefined,
    binaryPath: undefined,
    binarySource: undefined,
  });
}

export function opencodeManagedDataDir(homeDir: string): string {
  return nodePath().join(copilotAppDataDir(homeDir), "opencode");
}

export function legacyVaultDataDir(
  vaultBasePath: string,
  configDir: string,
  pluginId: string
): string {
  return nodePath().join(vaultBasePath, configDir, "plugins", pluginId, "data", "opencode");
}

export class OpencodeBinaryManager extends ManagedBinaryManager<InstallOptions> {
  constructor(private plugin: CopilotPlugin) {
    super("opencode");
  }

  protected readBinarySettings(): BinarySettings {
    const settings = readOpencodeSettings();
    return { ...settings, binarySource: settings.binarySource ?? "managed" };
  }

  protected updateBinarySettings(settings: BinarySettings): void {
    updateOpencodeFields(settings);
  }

  adoptPlugin(plugin: CopilotPlugin): void {
    this.plugin = plugin;
  }

  protected async runExclusive<T>(
    running: RuntimeState,
    body: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    try {
      return await super.runExclusive(running, body);
    } catch (error) {
      if (error instanceof ManagedInstallOperationInFlightError) {
        throw new OperationInFlightError();
      }
      throw error;
    }
  }

  async refreshInstallState(): Promise<void> {
    const s = readOpencodeSettings();
    if (!s.binaryPath || (s.binarySource ?? "managed") !== "managed") return;
    if (await fileExists(s.binaryPath)) return;
    logWarn(`[AgentMode] persisted opencode binary missing at ${s.binaryPath}; clearing settings.`);
    clearOpencodeBinary();
  }

  getDataDir(): string {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const home = requireNodeModule<typeof import("node:os")>("os").homedir();
    if (!home || !nodePath().isAbsolute(home) || nodePath().parse(home).root === home) {
      throw new Error(
        "Could not resolve your home directory to install the opencode runtime. " +
          "Agent Mode installs it under ~/.obsidian-copilot; check that your account has a valid home directory."
      );
    }
    return opencodeManagedDataDir(home);
  }

  protected async installPipeline(
    opts: ManagedBinaryPipelineOptions<InstallOptions>
  ): Promise<{ version: string; path: string }> {
    const version = opts.version ?? OPENCODE_PINNED_VERSION;
    // Manual retries must not replace a working selection with an unsupported release pin. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
    assertBinaryCompatible(
      { kind: "installed", version, source: "managed" },
      OPENCODE_MIN_VERSION,
      "opencode"
    );
    const dataDir = this.getDataDir();
    const versionDir = nodePath().join(dataDir, version);

    opts.progress.connecting();
    const { target, candidates } = await resolveOpencodeTarget();
    this.throwIfAborted(opts.signal);

    const asset = await resolveNpmAsset(version, candidates, opts.signal);
    this.throwIfAborted(opts.signal);

    const binName = expectedBinaryName(target.platform);
    const finalBinPath = nodePath().join(versionDir, "bin", binName);

    const existing = await readManifest(nodePath().join(versionDir, "install-manifest.json"));
    if (existing && existing.assetName === asset.name && (await fileExists(finalBinPath))) {
      logInfo(`[AgentMode] opencode ${version} already installed at ${finalBinPath}`);
      const cur = readOpencodeSettings();
      if (
        cur.binaryVersion !== version ||
        cur.binaryPath !== finalBinPath ||
        cur.binarySource !== "managed"
      ) {
        this.selectInstalledBinary({
          binaryVersion: version,
          binaryPath: finalBinPath,
          binarySource: "managed",
        });
      }
      opts.progress.done();
      return { version, path: finalBinPath };
    }

    try {
      await nodeFs().promises.mkdir(dataDir, { recursive: true });
    } catch (e) {
      throw new Error(
        `Could not create the opencode install directory at ${dataDir}: ` +
          `${e instanceof Error ? e.message : String(e)}. Check that it is writable.`
      );
    }
    const randomBytes = requireNodeModule<typeof import("node:crypto")>("crypto").randomBytes;
    const tmpDir = nodePath().join(dataDir, `.tmp-${version}-${randomBytes(4).toString("hex")}`);
    await nodeFs().promises.mkdir(tmpDir, { recursive: true });

    try {
      const archivePath = nodePath().join(tmpDir, asset.name);
      await downloadFile(asset.url, archivePath, {
        displayName: "opencode",
        signal: opts.signal,
        onProgress: (received, total) => opts.progress.download(received, total),
      });

      opts.progress.extracting();
      const extractDir = nodePath().join(tmpDir, "extract");
      await nodeFs().promises.mkdir(extractDir, { recursive: true });
      await verifyNpmIntegrity(archivePath, asset.integrity, opts.signal);
      await extractNpmBinary(
        archivePath,
        nodePath().join(extractDir, binName),
        binName,
        opts.signal
      );
      this.throwIfAborted(opts.signal);

      const extractedBin = nodePath().join(extractDir, binName);
      if (target.platform !== "windows") {
        await nodeFs().promises.chmod(extractedBin, 0o755);
      }

      const stageDir = nodePath().join(tmpDir, "stage");
      const stageBinDir = nodePath().join(stageDir, "bin");
      await nodeFs().promises.mkdir(stageBinDir, { recursive: true });
      await nodeFs().promises.rename(extractedBin, nodePath().join(stageBinDir, binName));

      const manifest: InstallManifest = {
        version,
        assetName: asset.name,
        installedAt: new Date().toISOString(),
      };
      await nodeFs().promises.writeFile(
        nodePath().join(stageDir, "install-manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      opts.progress.verifying();
      const verified = await verifyOpencodeBinary(nodePath().join(stageBinDir, binName));
      if (parseVersionFromStdout(verified.stdout) !== version)
        throw new Error(`The opencode download did not report version ${version}.`);
      this.throwIfAborted(opts.signal);
      opts.progress.activating();
      await promoteManagedVersion(stageDir, versionDir, "opencode");

      this.selectInstalledBinary({
        binaryVersion: version,
        binaryPath: finalBinPath,
        binarySource: "managed",
      });
      opts.progress.done();
      logInfo(`[AgentMode] opencode ${version} installed at ${finalBinPath}`);
      return { version, path: finalBinPath };
    } catch (err) {
      logError("[AgentMode] opencode install failed", err);
      throw err;
    } finally {
      await removeDir(tmpDir).catch(() => {});
    }
  }

  async upgradeManaged(opts: InstallOptions = {}): Promise<{ version: string; path: string }> {
    return this.runExclusive({ kind: "installing", progress: null }, async (signal) => {
      const prev = readOpencodeSettings();
      const result = await this.runInstallPipeline(signal, {
        ...opts,
        version: OPENCODE_PINNED_VERSION,
      });
      if (
        prev.binarySource === "managed" &&
        prev.binaryVersion &&
        prev.binaryVersion !== result.version
      ) {
        const oldDir = nodePath().join(this.getDataDir(), prev.binaryVersion);
        await removeDir(oldDir).catch((e) =>
          logWarn(`[AgentMode] failed to remove old opencode ${oldDir}: ${e}`)
        );
      }
      return result;
    });
  }

  async upgradeCustomBinary(): Promise<{ version: string; path: string }> {
    return this.runExclusive({ kind: "installing", progress: null }, async (signal) => {
      const s = readOpencodeSettings();
      if (s.binarySource !== "custom" || !s.binaryPath) {
        throw new Error("No custom opencode binary is configured to upgrade.");
      }
      const binaryPath = s.binaryPath;
      try {
        await execFileAsync(binaryPath, ["upgrade"], {
          signal,
          timeout: UPGRADE_BINARY_TIMEOUT_MS,
          windowsHide: true,
        });
      } catch (e) {
        this.throwIfAborted(signal);
        const err = e as NodeJS.ErrnoException;
        throw new Error(`\`${binaryPath} upgrade\` failed: ${err.message ?? String(err)}`);
      }
      const { stdout } = await verifyOpencodeBinary(binaryPath);
      this.throwIfAborted(signal);
      const version = parseVersionFromStdout(stdout);
      if (!version) {
        throw new Error(`${binaryPath} --version didn't report a version after upgrade.`);
      }
      if (isOpencodeVersionOutdated(version)) {
        throw new Error(
          `opencode upgrade did not reach the required version ${OPENCODE_MIN_VERSION}+ ` +
            `(still v${version}).`
        );
      }
      updateOpencodeFields({ binaryVersion: version, binaryPath, binarySource: "custom" });
      logInfo(`[AgentMode] upgraded custom opencode to ${version}`);
      return { version, path: binaryPath };
    });
  }

  protected reclaimableDirs(): string[] {
    const dirs: string[] = [];
    try {
      dirs.push(this.getDataDir());
    } catch {}
    const adapter = this.plugin.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      dirs.push(
        legacyVaultDataDir(
          adapter.getBasePath(),
          this.plugin.app.vault.configDir,
          this.plugin.manifest.id
        )
      );
    }
    return dirs;
  }

  protected async validateCustomBinary(p: string): Promise<InstalledBinary> {
    const { stdout } = await verifyOpencodeBinary(p);
    const version = parseVersionFromStdout(stdout);
    if (!version) {
      throw new Error(
        `${p} --version output didn't include a version number. Is this an opencode binary?`
      );
    }
    return { version, path: p };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
  }
}

export function parseVersionFromStdout(stdout: string): string | undefined {
  const match = stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
  return match?.[0];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await nodeFs().promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(p: string): Promise<InstallManifest | null> {
  try {
    const raw = await nodeFs().promises.readFile(p, "utf-8");
    return JSON.parse(raw) as InstallManifest;
  } catch {
    return null;
  }
}

async function removeDir(p: string): Promise<void> {
  await nodeFs().promises.rm(p, { recursive: true, force: true });
}

export async function verifyOpencodeBinary(p: string): Promise<{ stdout: string }> {
  try {
    const { stdout } = await execFileAsync(p, ["--version"], {
      timeout: VERIFY_BINARY_TIMEOUT_MS,
      windowsHide: true,
    });
    return { stdout: stdout.toString().trim() };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { signal?: string; code?: string | number };
    if (err.code === "ENOENT") {
      throw new Error(`No file at ${p}`);
    }
    if (err.signal === "SIGTERM") {
      throw new Error(
        `${p} did not respond to --version within ${VERIFY_BINARY_TIMEOUT_MS}ms. Is this an opencode binary?`
      );
    }
    throw new Error(
      `${p} --version failed: ${err.message ?? String(err)}. Is this an opencode binary?`
    );
  }
}
