import {
  classifyBinaryInstall,
  assertBinaryCompatible,
} from "@/agentMode/backends/shared/binaryCompatibility";
import { downloadFile } from "@/agentMode/backends/shared/downloadFile";
import { extractArchive } from "@/agentMode/backends/shared/extractArchive";
import {
  ManagedBinaryManager,
  type BinarySettings,
  type InstalledBinary,
  type ManagedBinaryInstallOptions,
  type ManagedBinaryPipelineOptions,
} from "@/agentMode/backends/shared/ManagedBinaryManager";
import { OPENCODE_MIN_VERSION, OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import { OPENCODE_RELEASE_API_URL_TEMPLATE } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type OpencodeBackendSettings } from "@/settings/model";
import { FileSystemAdapter, requestUrl } from "obsidian";
import { copilotAppDataDir } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { expectedBinaryName, resolveOpencodeTarget } from "./platformResolver";
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
// Generous: first-run on Windows (Defender real-time scan) and macOS
// (Gatekeeper translocation) can add a few seconds before the binary responds.
const VERIFY_BINARY_TIMEOUT_MS = 8_000;
// `opencode upgrade` downloads and swaps a release binary — give it room.
const UPGRADE_BINARY_TIMEOUT_MS = 180_000;

export interface InstallOptions extends ManagedBinaryInstallOptions {
  /** Override pinned version. Defaults to OPENCODE_PINNED_VERSION. */
  version?: string;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "installed"; version: string; path: string; source: "managed" | "custom" };

/**
 * What the manager is currently doing to the opencode binary, as opposed to
 * {@link InstallState}, which is what the *persisted settings* say. Every UI
 * that can start one of these operations reads this, so none of them offers a
 * competing action while one is running.
 *
 * `busy` covers the operations with nothing to show but the fact that they are
 * running; `installing` is separate because it carries download progress.
 */
export type RuntimeState = ManagedInstallRuntimeState;

/** Thrown when a second binary-path operation is started while one is running. */
export class OperationInFlightError extends ManagedInstallOperationInFlightError {
  constructor() {
    super("opencode");
    this.name = "OperationInFlightError";
  }
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
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

export function pickMatchingAsset(release: GithubRelease, candidates: string[]): GithubAsset {
  const ARCHIVE_EXTS = [".zip", ".tar.gz", ".tar.xz", ".tgz"];
  const stemOf = (name: string): string => {
    for (const ext of ARCHIVE_EXTS) {
      if (name.endsWith(ext)) return name.slice(0, -ext.length);
    }
    return name;
  };

  const byStem = new Map<string, GithubAsset>();
  for (const a of release.assets) {
    byStem.set(stemOf(a.name), a);
  }

  for (const stem of candidates) {
    const asset = byStem.get(stem);
    if (asset) return asset;
  }

  throw new Error(
    `No matching opencode release asset found. Tried: ${candidates.join(", ")}. ` +
      `Available: ${release.assets.map((a) => a.name).join(", ")}`
  );
}

/**
 * Reports whether the configured OpenCode executable exists on this device.
 * Synced settings can point to a file that exists only on another device;
 * returning `absent` lets Copilot offer installation instead of trying to launch it.
 * Version compatibility is checked separately by toOpencodeInstallState.
 *
 * @param opencode - Saved OpenCode path, version, and installation source.
 * @param fileExists - Checks whether the configured executable exists locally.
 */
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

/** Read the OpenCode-specific settings slice from current settings. */
export function readOpencodeSettings(): OpencodeBackendSettings {
  return getSettings().agentMode?.backends?.opencode ?? {};
}

/**
 * Returns whether a reported OpenCode version fails Copilot's compatibility check.
 * Older versions, prereleases of OPENCODE_MIN_VERSION, and malformed versions fail.
 * Missing or empty versions return false because installation detection handles them.
 *
 * @param version - Version reported by the OpenCode executable, if available.
 */
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

/**
 * Converts a detected OpenCode installation into the status shown by Copilot:
 * `ready`, `incompatible` with OPENCODE_MIN_VERSION, `error` for invalid version
 * metadata, or `absent` when no installation was found.
 *
 * @param state - Locally detected installation with its saved version and source.
 */
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

/**
 * Per-user, OS-local directory the managed opencode binary installs into,
 * OUTSIDE the Obsidian vault — `~/.obsidian-copilot/opencode`. Composed under
 * the shared {@link copilotAppDataDir} root so the namespace is defined once.
 * Mirrors how companion tools install their CLIs under the home dir (e.g.
 * Miyo's `~/.miyo/bin`).
 *
 * Why not the plugin data dir (`<vault>/.obsidian/plugins/copilot/data/...`):
 * that lives inside the vault, so sync services (Obsidian Sync, iCloud,
 * Dropbox, Syncthing) replicate the ~100MB binary across devices — but the
 * binary is per-OS and per-arch, so a synced copy is useless (or broken) on
 * another machine. Keeping it under the home dir takes it out of every sync
 * scope while staying per-user.
 */
export function opencodeManagedDataDir(homeDir: string): string {
  return nodePath().join(copilotAppDataDir(homeDir), "opencode");
}

/**
 * The pre-#2569 in-vault install root,
 * `<vault>/.obsidian/plugins/<id>/data/opencode`. Managed installs used to
 * live here and were replicated across devices by every sync service.
 *
 * Kept only so the user-triggered {@link OpencodeBinaryManager.uninstall} can
 * reclaim a preview tester's stale in-vault copy in the same click — there is
 * no auto-running migration. Never written to.
 */
export function legacyVaultDataDir(
  vaultBasePath: string,
  configDir: string,
  pluginId: string
): string {
  return nodePath().join(vaultBasePath, configDir, "plugins", pluginId, "data", "opencode");
}

/**
 * Manages the lifecycle of the opencode binary on disk: platform-aware
 * download from GitHub releases, extraction into a per-user OS-local dir
 * (outside the vault, see {@link opencodeManagedDataDir}), and persistence of
 * the install location into `settings.agentMode`. Desktop-only.
 */
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

  /**
   * Point the manager at the plugin instance of the lifecycle now running.
   *
   * The manager is cached at module scope and deliberately outlives a lifecycle
   * (the carry-over `main.ts` documents), so the plugin it was constructed with
   * can name a vault that is no longer open. {@link uninstall} deletes an
   * in-vault path derived from that plugin — left stale, it would delete out of
   * the previous vault. Only the handle is replaced, so a run still in flight
   * is adopted rather than restarted.
   *
   * Call this once per lifecycle, from the backend's `onPluginLoad` and nowhere
   * else. The binding is global mutable state read at operation time, so a
   * caller that rebound on its way in would retarget the manager for every
   * holder — including surfaces of the lifecycle that is actually running.
   *
   * @param plugin - The current lifecycle's plugin, whose vault every in-vault
   * path must be derived from.
   */
  adoptPlugin(plugin: CopilotPlugin): void {
    this.plugin = plugin;
  }

  /**
   * Run `body` as the one binary-path operation, publishing `running` for its
   * duration and settling back to idle (or to an error the UI can show).
   *
   * Every *user-triggered* operation that writes `binaryPath`/`binarySource`
   * goes through here, which is what makes the lock useful: guarding only the
   * managed install would still let the Configure dialog apply a custom path
   * underneath it. {@link refreshInstallState} is the one writer outside, and
   * says there why.
   *
   * @param running - State published while `body` runs.
   * @param body - Receives the signal to honour for cancellation.
   */
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

  getInstallState(): InstallState {
    return computeInstallState(readOpencodeSettings());
  }

  /**
   * Reconcile persisted install state with what's actually on disk. If we
   * believe a managed install exists but the binary is gone (user deleted it,
   * restored a vault from backup, etc.), demote to `absent`. Skipped for
   * custom-source installs — re-checking on every plugin load would punish
   * users for transient filesystem hiccups (network mounts, etc.).
   *
   * DESIGN NOTE — this is the one `binaryPath` writer that stays outside
   * {@link runExclusive}, and the residual race is accepted. To lose data a
   * user needs a managed path whose file is already gone, an install still
   * running from a previous lifecycle, a reload landing mid-run, AND the
   * single `fileExists` stat below straddling the instant that install
   * persists its result — at which point the clear would wipe the fresh
   * install. Taking the lock here would be worse: a reconcile at load would
   * throw `OperationInFlightError` on every plugin load that happens during a
   * download, turning a millisecond-wide race into a routine failure. If a
   * future review flags this again, point them at this note; the cheap fix, if
   * it ever bites, is to re-read settings after the await and only clear when
   * the path still matches the one checked.
   */
  async refreshInstallState(): Promise<void> {
    // Read raw settings (not getInstallState) so we can still see a configured
    // path whose file is gone — getInstallState now reports that as `absent`.
    // Only auto-clear a *managed* install whose binary vanished; a custom path
    // is the user's to manage and may point at a not-yet-mounted volume.
    const s = readOpencodeSettings();
    if (!s.binaryPath || (s.binarySource ?? "managed") !== "managed") return;
    if (await fileExists(s.binaryPath)) return;
    logWarn(`[AgentMode] persisted opencode binary missing at ${s.binaryPath}; clearing settings.`);
    clearOpencodeBinary();
  }

  /**
   * Absolute path to the per-user, OS-local opencode install root, OUTSIDE the
   * vault (`~/.obsidian-copilot/opencode`). See {@link opencodeManagedDataDir}
   * for why this is not under the synced plugin data dir.
   */
  getDataDir(): string {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const home = requireNodeModule<typeof import("node:os")>("os").homedir();
    // Guard against a missing/garbage home dir (empty string, or the filesystem
    // root) before we build an install path under it: `os.homedir()` can return
    // "" in broken/sandboxed environments, and installing into `/.obsidian-copilot`
    // would be wrong and almost certainly unwritable. Fail with an actionable
    // message instead of a confusing downstream spawn error.
    if (!home || !nodePath().isAbsolute(home) || nodePath().parse(home).root === home) {
      throw new Error(
        "Could not resolve your home directory to install the opencode runtime. " +
          "Agent Mode installs it under ~/.obsidian-copilot; check that your account has a valid home directory."
      );
    }
    return opencodeManagedDataDir(home);
  }

  /**
   * Installs and selects a supported OpenCode release, reusing matching files
   * when possible. The caller must hold the installation lock so an upgrade can
   * install the replacement and remove the old version as one operation.
   *
   * @param opts - Release version, progress reporter, and cancellation signal.
   */
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

    const release = await this.fetchReleaseMetadata(version);
    this.throwIfAborted(opts.signal);

    const asset = pickMatchingAsset(release, candidates);

    const binName = expectedBinaryName(target.platform);
    const finalBinPath = nodePath().join(versionDir, "bin", binName);

    // Idempotency: if the existing manifest matches and the binary is in place, no-op.
    const existing = await readManifest(nodePath().join(versionDir, "install-manifest.json"));
    if (existing && existing.assetName === asset.name && (await fileExists(finalBinPath))) {
      logInfo(`[AgentMode] opencode ${version} already installed at ${finalBinPath}`);
      // Skip the write when settings already match — avoids spuriously waking
      // every settings subscriber on healthy plugin loads.
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

    // Create the OS-local install root up front so an unwritable home dir
    // (sandboxed/confined HOME on Linux Flatpak/Snap, locked-down accounts)
    // fails here with an actionable message naming the path, rather than later
    // mid-extraction.
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
      await downloadFile(asset.browser_download_url, archivePath, {
        displayName: "opencode",
        bytes: asset.size,
        signal: opts.signal,
        onProgress: (received, total) => opts.progress.download(received, total),
      });

      opts.progress.extracting();
      const extractDir = nodePath().join(tmpDir, "extract");
      await nodeFs().promises.mkdir(extractDir, { recursive: true });
      await extractArchive(archivePath, extractDir);
      this.throwIfAborted(opts.signal);

      const extractedBin = await locateFile(extractDir, binName);
      if (target.platform !== "windows") {
        await nodeFs().promises.chmod(extractedBin, 0o755);
      }

      // Stage the final layout under tmpDir, then atomically rename into place.
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

      // Verification must finish before any published directory changes.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/530
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

  /**
   * Upgrade a managed install to the pinned version: install the pinned binary
   * (atomic — the existing one keeps working until the new one is staged in),
   * then remove the previously-active managed version dir when it differs.
   *
   * Owns the operation itself and drives {@link installPipeline} directly, so
   * the run stays locked — and the row stays on "installing" — until the old
   * version dir is gone, not just until the new binary lands.
   */
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

  /**
   * Upgrade a user-supplied opencode binary in place via its own
   * `<binary> upgrade`, then re-verify and persist the new version. The binary
   * stays where the user put it (`binarySource:"custom"`); managed version dirs
   * are untouched. Throws with a readable message on failure.
   */
  async upgradeCustomBinary(): Promise<{ version: string; path: string }> {
    return this.runExclusive({ kind: "installing", progress: null }, async (signal) => {
      const s = readOpencodeSettings();
      if (s.binarySource !== "custom" || !s.binaryPath) {
        throw new Error("No custom opencode binary is configured to upgrade.");
      }
      const binaryPath = s.binaryPath;
      try {
        await execFileAsync(binaryPath, ["upgrade"], {
          // Configure exposes Cancel for this shared operation; stop the process as well.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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
      // Cancellation during validation must not publish an updated configuration.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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

  /**
   * Every dir {@link uninstall} reclaims: the OS-local managed root plus the
   * pre-#2569 in-vault copy (so a tester who just updated, and still has the
   * binary only inside the vault, isn't told there's nothing to remove).
   * `getDataDir()` is resolved defensively so a bad home dir doesn't block
   * reclaiming the in-vault copy.
   */
  protected reclaimableDirs(): string[] {
    const dirs: string[] = [];
    try {
      dirs.push(this.getDataDir());
    } catch {
      /* unusable home dir — nothing managed to reclaim there */
    }
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

  private async fetchReleaseMetadata(version: string): Promise<GithubRelease> {
    const url = OPENCODE_RELEASE_API_URL_TEMPLATE.replace("{version}", version);
    const res = await requestUrl({
      url,
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      throw: false,
    });
    if (res.status === 403) {
      throw new Error(
        "GitHub API rate-limited (60/hour for unauthenticated requests). Set GITHUB_TOKEN or retry later."
      );
    }
    if (res.status === 404) {
      throw new Error(`opencode release v${version} not found on GitHub.`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub release fetch failed with status ${res.status}`);
    }
    return res.json as GithubRelease;
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
  }
}

// Tolerant of leading `v`, build metadata, etc. — keeps the parser working
// across opencode releases that decorate the version string differently.
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

// BFS because the binary's depth inside the upstream archive varies across
// opencode releases — first match wins.
async function locateFile(root: string, name: string): Promise<string> {
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const entries = await nodeFs().promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = nodePath().join(dir, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.isFile() && e.name === name) return full;
    }
  }
  throw new Error(`File "${name}" not found anywhere under ${root}`);
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
