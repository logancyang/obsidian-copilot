import { OPENCODE_MIN_ACP_VERSION, OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import { OPENCODE_RELEASE_API_URL_TEMPLATE } from "@/constants";
import { compareSemver } from "@/utils/semver";
import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings, type OpencodeBackendSettings } from "@/settings/model";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import { IncomingMessage } from "node:http";
import { FileSystemAdapter, requestUrl } from "obsidian";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { renameWithRetry } from "@/agentMode/skills/renameWithRetry";
import { copilotAppDataDir } from "@/utils/appPaths";
import { detectOpencodeCliPath } from "./opencodeCliDetector";
import { expectedBinaryName, resolveOpencodeTarget } from "./platformResolver";
import type { InstallState as BackendInstallState } from "@/agentMode/session/types";

const execFileAsync = promisify(execFile);
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000;
// Generous: first-run on Windows (Defender real-time scan) and macOS
// (Gatekeeper translocation) can add a few seconds before the binary responds.
const VERIFY_BINARY_TIMEOUT_MS = 8_000;
// `opencode upgrade` downloads and swaps a release binary — give it room.
const UPGRADE_BINARY_TIMEOUT_MS = 180_000;

export type ProgressEvent =
  | { phase: "resolve"; message: string }
  | { phase: "download"; received: number; total?: number; assetName: string }
  | { phase: "extract"; message: string }
  | { phase: "done"; version: string; path: string };

export interface InstallOptions {
  onProgress?: (e: ProgressEvent) => void;
  /** Override pinned version. Defaults to OPENCODE_PINNED_VERSION. */
  version?: string;
}

/**
 * What the install pipeline needs on top of the public options. The signal is
 * absent from {@link InstallOptions} on purpose: the manager owns cancellation
 * through {@link OpencodeBinaryManager.cancelCurrentOperation}, so a caller
 * cannot supply one, and the pipeline only ever receives the manager's own.
 */
interface InstallPipelineOptions extends InstallOptions {
  signal?: AbortSignal;
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
export type RuntimeState =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; progress: ProgressEvent | null }
  | { kind: "busy" }
  | { kind: "error"; message: string };

/** Thrown when a second binary-path operation is started while one is running. */
export class OperationInFlightError extends Error {
  constructor() {
    super("An opencode setup operation is already running.");
    this.name = "OperationInFlightError";
  }
}

/**
 * Thrown when auto-detect finds no opencode to adopt. A failure rather than an
 * empty success so it lands in the runtime error state: the settings row swaps
 * its adopt action for Configure only while showing an error, and Configure is
 * the sole way to reach a binary outside the searched locations.
 *
 * The message names no control, because every surface subscribed to the runtime
 * state renders it — including the Configure dialog itself, where telling the
 * user to open Configure would contradict where they already are.
 */
export class OpencodeNotFoundError extends Error {
  constructor() {
    super("Couldn't find opencode in the usual install locations or on PATH.");
    this.name = "OpencodeNotFoundError";
  }
}

const describeOperationError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

export class AbortError extends Error {
  constructor() {
    super("Aborted");
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
 * Derive the install state from the persisted `agentMode.backends.opencode`
 * slice. A configured `binaryPath` whose file is missing on this device counts
 * as `absent`, not `installed`: when a vault syncs to a second device the path
 * can be present in settings while the binary was never installed locally
 * (logancyang/obsidian-copilot-preview#123). Reporting `absent` surfaces the
 * install prompt and skips the auto-spawn that otherwise fails with a cryptic
 * error at load. `fileExists` is injected so the branch is unit-testable
 * without touching disk.
 */
export function computeInstallState(
  opencode: OpencodeBackendSettings | undefined,
  fileExists: (path: string) => boolean = (p) => fs.existsSync(p)
): InstallState {
  const s = opencode ?? {};
  if (s.binaryPath && s.binaryVersion && fileExists(s.binaryPath)) {
    return {
      kind: "installed",
      version: s.binaryVersion,
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
 * Whether an installed opencode version predates the minimum the plugin
 * supports ({@link OPENCODE_MIN_ACP_VERSION}). Older binaries either predate
 * the current model catalog or leave the backing turn running after ACP
 * cancellation. An unknown version isn't flagged — we can't prove it's old,
 * and a missing install is handled by the install prompt instead.
 */
export function isOpencodeVersionOutdated(version: string | undefined): boolean {
  if (!version) return false;
  return compareSemver(version, OPENCODE_MIN_ACP_VERSION) < 0;
}

/**
 * Gives every OpenCode entry point one readiness policy so outdated installs are handled consistently.
 * @param state - The detected OpenCode installation state to interpret for backend use.
 */
export function toOpencodeInstallState(state: InstallState): BackendInstallState {
  if (state.kind === "absent") return state;
  if (!isOpencodeVersionOutdated(state.version)) {
    return { kind: "ready", source: state.source };
  }
  return {
    kind: "incompatible",
    source: state.source,
    currentVersion: state.version,
    minVersion: OPENCODE_MIN_ACP_VERSION,
    message: `opencode v${state.version} is not supported. Copilot requires opencode v${OPENCODE_MIN_ACP_VERSION} or newer.`,
  };
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
  return path.join(copilotAppDataDir(homeDir), "opencode");
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
  return path.join(vaultBasePath, configDir, "plugins", pluginId, "data", "opencode");
}

/**
 * Manages the lifecycle of the opencode binary on disk: platform-aware
 * download from GitHub releases, extraction into a per-user OS-local dir
 * (outside the vault, see {@link opencodeManagedDataDir}), and persistence of
 * the install location into `settings.agentMode`. Desktop-only.
 */
export class OpencodeBinaryManager {
  constructor(private plugin: CopilotPlugin) {}

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
   * The operation currently holding the binary-path write lock, or null. Only
   * one may run at a time: `install` lands a managed binary and
   * `setCustomBinaryPath` saves a user-supplied one, but both write the same
   * `binaryPath`/`binarySource` settings, so two in flight would let whichever
   * settled last decide the source the user did not choose last.
   *
   * DESIGN NOTE — this deliberately outlives a plugin lifecycle. Module scope
   * survives disable→enable, dev hot reload, and "Open another vault" in the
   * same process (`main.ts` says so where it resets the persistence
   * singletons), and `getOpencodeBinaryManager` caches this manager at module
   * scope, so an operation started in one lifecycle is still here in the next.
   * That carry-over is coherent rather than corrupting: every UI reads the same
   * runtime state and offers no competing action while it is set, so the next
   * lifecycle adopts the run instead of starting a rival one.
   *
   * The one effect that crosses the boundary is the settings write when an
   * install lands, and it is accurate: `getDataDir()` builds under
   * `os.homedir()`, so the binary it names really is installed for whatever
   * vault is open. The vault that started the download is the one left out, and
   * it self-heals — `install()` is idempotent, so Download there returns
   * instantly off the existing manifest.
   * If a future review flags the lifecycle boundary, point them at this note.
   */
  private operation: { controller: AbortController } | null = null;
  private runtimeState: RuntimeState = { kind: "idle" };
  private readonly runtimeSubscribers = new Set<() => void>();

  /**
   * Subscribe to {@link getRuntimeState}. Bound once so React's
   * `useSyncExternalStore` sees a stable reference and does not resubscribe on
   * every render.
   */
  readonly subscribeRuntimeState = (onChange: () => void): (() => void) => {
    this.runtimeSubscribers.add(onChange);
    return () => {
      this.runtimeSubscribers.delete(onChange);
    };
  };

  /**
   * Current runtime state. The returned object is replaced, never mutated, so
   * `useSyncExternalStore` can compare snapshots by identity.
   */
  readonly getRuntimeState = (): RuntimeState => this.runtimeState;

  private setRuntimeState(next: RuntimeState): void {
    this.runtimeState = next;
    this.runtimeSubscribers.forEach((notify) => notify());
  }

  /**
   * Drop a failure left over from a previous plugin lifecycle, so a new one
   * does not open showing an error nobody here caused.
   *
   * The rest of the runtime state is deliberately kept: a run still in flight
   * belongs to this process and the new lifecycle adopts it rather than
   * offering a rival action (see the note on {@link operation}). Only a settled
   * error is stale — it describes an attempt that ended, in a vault that may
   * not even be the one now open.
   */
  forgetSettledError(): void {
    if (this.operation || this.runtimeState.kind !== "error") return;
    this.setRuntimeState({ kind: "idle" });
  }

  /** Whether a binary-path operation is running, from any entry point. */
  isBusy(): boolean {
    return this.operation !== null;
  }

  /**
   * Cancel the running operation, if it is one that can be cancelled. A no-op
   * otherwise — only the managed install is interruptible.
   */
  cancelCurrentOperation(): void {
    this.operation?.controller.abort();
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
  private async runExclusive<T>(
    running: RuntimeState,
    body: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.operation) throw new OperationInFlightError();
    const controller = new AbortController();
    this.operation = { controller };
    this.setRuntimeState(running);
    try {
      const result = await body(controller.signal);
      this.operation = null;
      this.setRuntimeState({ kind: "idle" });
      return result;
    } catch (e) {
      this.operation = null;
      // A cancellation is the user's own doing, so it returns to idle rather
      // than reporting a failure they would have to dismiss.
      if (e instanceof AbortError || (e as Error | undefined)?.name === "AbortError") {
        this.setRuntimeState({ kind: "idle" });
      } else {
        this.setRuntimeState({ kind: "error", message: describeOperationError(e) });
      }
      throw e;
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
    const home = os.homedir();
    // Guard against a missing/garbage home dir (empty string, or the filesystem
    // root) before we build an install path under it: `os.homedir()` can return
    // "" in broken/sandboxed environments, and installing into `/.obsidian-copilot`
    // would be wrong and almost certainly unwritable. Fail with an actionable
    // message instead of a confusing downstream spawn error.
    if (!home || !path.isAbsolute(home) || path.parse(home).root === home) {
      throw new Error(
        "Could not resolve your home directory to install the opencode runtime. " +
          "Agent Mode installs it under ~/.obsidian-copilot; check that your account has a valid home directory."
      );
    }
    return opencodeManagedDataDir(home);
  }

  getPinnedVersion(): string {
    return OPENCODE_PINNED_VERSION;
  }

  /**
   * Download and activate the pinned opencode build, holding the binary-path
   * lock for the whole run and publishing download progress as it goes.
   */
  async install(opts: InstallOptions = {}): Promise<{ version: string; path: string }> {
    return this.runExclusive({ kind: "installing", progress: null }, (signal) => {
      return this.installPipeline({
        ...opts,
        signal,
        onProgress: (e) => {
          this.setRuntimeState({ kind: "installing", progress: e });
          opts.onProgress?.(e);
        },
      });
    });
  }

  /**
   * Full install pipeline: resolve target → fetch release metadata →
   * download → extract → atomic rename → persist settings. Idempotent when
   * an existing install matches the pinned manifest.
   *
   * Private and lock-free on purpose: {@link install} and
   * {@link upgradeManaged} are the entry points that own an operation, and
   * upgrade calls this directly so it does not re-enter the lock it already
   * holds — or settle the run to idle before it has removed the old version.
   */
  private async installPipeline(
    opts: InstallPipelineOptions = {}
  ): Promise<{ version: string; path: string }> {
    const version = opts.version ?? OPENCODE_PINNED_VERSION;
    const dataDir = this.getDataDir();
    const versionDir = path.join(dataDir, version);

    opts.onProgress?.({ phase: "resolve", message: "Resolving platform asset…" });
    const { target, candidates } = await resolveOpencodeTarget();
    this.throwIfAborted(opts.signal);

    const release = await this.fetchReleaseMetadata(version);
    this.throwIfAborted(opts.signal);

    const asset = pickMatchingAsset(release, candidates);

    const binName = expectedBinaryName(target.platform);
    const finalBinPath = path.join(versionDir, "bin", binName);

    // Idempotency: if the existing manifest matches and the binary is in place, no-op.
    const existing = await readManifest(path.join(versionDir, "install-manifest.json"));
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
        updateOpencodeFields({
          binaryVersion: version,
          binaryPath: finalBinPath,
          binarySource: "managed",
        });
      }
      opts.onProgress?.({ phase: "done", version, path: finalBinPath });
      return { version, path: finalBinPath };
    }

    // Create the OS-local install root up front so an unwritable home dir
    // (sandboxed/confined HOME on Linux Flatpak/Snap, locked-down accounts)
    // fails here with an actionable message naming the path, rather than later
    // mid-extraction.
    try {
      await fs.promises.mkdir(dataDir, { recursive: true });
    } catch (e) {
      throw new Error(
        `Could not create the opencode install directory at ${dataDir}: ` +
          `${e instanceof Error ? e.message : String(e)}. Check that it is writable.`
      );
    }
    const tmpDir = path.join(dataDir, `.tmp-${version}-${randomBytes(4).toString("hex")}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });

    try {
      const archivePath = path.join(tmpDir, asset.name);
      await downloadToFile(asset.browser_download_url, archivePath, asset.size, opts);
      this.throwIfAborted(opts.signal);

      opts.onProgress?.({ phase: "extract", message: "Extracting archive…" });
      const extractDir = path.join(tmpDir, "extract");
      await fs.promises.mkdir(extractDir, { recursive: true });
      await extractArchive(archivePath, extractDir);
      this.throwIfAborted(opts.signal);

      const extractedBin = await locateFile(extractDir, binName);
      if (target.platform !== "windows") {
        await fs.promises.chmod(extractedBin, 0o755);
      }

      // Stage the final layout under tmpDir, then atomically rename into place.
      const stageDir = path.join(tmpDir, "stage");
      const stageBinDir = path.join(stageDir, "bin");
      await fs.promises.mkdir(stageBinDir, { recursive: true });
      await fs.promises.rename(extractedBin, path.join(stageBinDir, binName));

      const manifest: InstallManifest = {
        version,
        assetName: asset.name,
        installedAt: new Date().toISOString(),
      };
      await fs.promises.writeFile(
        path.join(stageDir, "install-manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      // Rename-aside-then-rename: move any existing versionDir out of the way,
      // promote the staged dir into place, and only then delete the old one.
      // If the second rename fails, we restore the original so the user keeps
      // a working install instead of a half-deleted one.
      let asideDir: string | null = null;
      if (await fileExists(versionDir)) {
        asideDir = `${versionDir}.old-${randomBytes(4).toString("hex")}`;
        await renameWithRetry(versionDir, asideDir);
      }
      try {
        await renameWithRetry(stageDir, versionDir);
      } catch (e) {
        if (asideDir) {
          await renameWithRetry(asideDir, versionDir).catch((restoreErr) =>
            logError("[AgentMode] failed to restore previous opencode install", restoreErr)
          );
        }
        throw e;
      }
      if (asideDir) {
        await removeDir(asideDir).catch((rmErr) =>
          logWarn(`[AgentMode] failed to remove ${asideDir}: ${rmErr}`)
        );
      }

      // Smoke-test the installed binary. Catches corrupt extracts and
      // platform/libc mismatches before the user hits them at ACP boot —
      // failures here surface in the install Modal where a Retry is one click
      // away.
      await verifyOpencodeBinary(finalBinPath);
      this.throwIfAborted(opts.signal);

      updateOpencodeFields({
        binaryVersion: version,
        binaryPath: finalBinPath,
        binarySource: "managed",
      });
      opts.onProgress?.({ phase: "done", version, path: finalBinPath });
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
      const result = await this.installPipeline({
        ...opts,
        signal,
        version: OPENCODE_PINNED_VERSION,
        onProgress: (e) => {
          this.setRuntimeState({ kind: "installing", progress: e });
          opts.onProgress?.(e);
        },
      });
      if (
        prev.binarySource === "managed" &&
        prev.binaryVersion &&
        prev.binaryVersion !== result.version
      ) {
        const oldDir = path.join(this.getDataDir(), prev.binaryVersion);
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
    return this.runExclusive({ kind: "busy" }, async () => {
      const s = readOpencodeSettings();
      if (s.binarySource !== "custom" || !s.binaryPath) {
        throw new Error("No custom opencode binary is configured to upgrade.");
      }
      const binaryPath = s.binaryPath;
      try {
        await execFileAsync(binaryPath, ["upgrade"], {
          timeout: UPGRADE_BINARY_TIMEOUT_MS,
          windowsHide: true,
        });
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        throw new Error(`\`${binaryPath} upgrade\` failed: ${err.message ?? String(err)}`);
      }
      const { stdout } = await verifyOpencodeBinary(binaryPath);
      const version = parseVersionFromStdout(stdout);
      if (!version) {
        throw new Error(`${binaryPath} --version didn't report a version after upgrade.`);
      }
      if (isOpencodeVersionOutdated(version)) {
        throw new Error(
          `opencode upgrade did not reach the required version ${OPENCODE_MIN_ACP_VERSION}+ ` +
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
  private reclaimableDirs(): string[] {
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

  /** Total bytes of every downloaded managed binary (OS-local + legacy in-vault). */
  async downloadsSize(): Promise<number> {
    const sizes = await Promise.all(this.reclaimableDirs().map(dirSize));
    return sizes.reduce((total, n) => total + n, 0);
  }

  /**
   * Uninstall the managed opencode binary: remove EVERY downloaded copy — the
   * whole OS-local `~/.obsidian-copilot/opencode` tree (all versions) AND the
   * pre-#2569 in-vault copy — then clear managed settings.
   *
   * Wiping the legacy in-vault dir here means a preview tester migrates off the
   * synced copy in one click (Uninstall, then Install). A custom binary path is
   * left untouched — it lives outside our dirs and belongs to the user.
   */
  async uninstall(): Promise<void> {
    return this.runExclusive({ kind: "busy" }, async () => {
      await Promise.all(this.reclaimableDirs().map((dir) => removeDir(dir)));
      if (readOpencodeSettings().binarySource !== "custom") {
        clearOpencodeBinary();
      }
    });
  }

  /**
   * Point Agent Mode at a user-supplied opencode binary. Pass `null` to
   * clear the override (without removing any managed install on disk).
   * Performs filesystem checks plus a `--version` smoke test so misconfigured
   * paths are caught at config time rather than later when ACP tries to boot.
   */
  async setCustomBinaryPath(p: string | null): Promise<void> {
    return this.runExclusive({ kind: "busy" }, () => this.writeCustomBinaryPath(p));
  }

  /**
   * Find an opencode the user installed themselves and adopt it.
   *
   * One operation rather than a detect the caller follows with
   * {@link setCustomBinaryPath}: the lock has to span the search as well as the
   * write, or a managed install started while the search was still running
   * would land in between and leave settings naming a source the user did not
   * choose last.
   *
   * @returns the adopted path.
   * @throws OpencodeNotFoundError when the search turns up nothing.
   */
  async adoptExistingBinary(): Promise<string> {
    return this.runExclusive({ kind: "detecting" }, async () => {
      const found = await detectOpencodeCliPath();
      if (!found) throw new OpencodeNotFoundError();
      await this.writeCustomBinaryPath(found);
      return found;
    });
  }

  /** Validate and persist a custom binary path. Assumes the lock is held. */
  private async writeCustomBinaryPath(p: string | null): Promise<void> {
    if (p === null) {
      clearOpencodeBinary();
      return;
    }
    const stat = await fs.promises.stat(p).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`No file at ${p}`);
    }
    if (process.platform !== "win32") {
      try {
        await fs.promises.access(p, fs.constants.X_OK);
      } catch {
        throw new Error(`${p} is not executable. chmod +x and try again.`);
      }
    }
    const { stdout } = await verifyOpencodeBinary(p);
    const version = parseVersionFromStdout(stdout);
    if (!version) {
      throw new Error(
        `${p} --version output didn't include a version number. Is this an opencode binary?`
      );
    }
    updateOpencodeFields({ binaryVersion: version, binaryPath: p, binarySource: "custom" });
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

  private throwIfAborted(signal?: AbortSignal): void {
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
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(p: string): Promise<InstallManifest | null> {
  try {
    const raw = await fs.promises.readFile(p, "utf-8");
    return JSON.parse(raw) as InstallManifest;
  } catch {
    return null;
  }
}

async function removeDir(p: string): Promise<void> {
  await fs.promises.rm(p, { recursive: true, force: true });
}

/** Recursively sum the byte size of all files under `dir`; 0 if it's absent. */
async function dirSize(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirSize(full);
    } else if (e.isFile()) {
      total += await fs.promises
        .stat(full)
        .then((s) => s.size)
        .catch(() => 0);
    }
  }
  return total;
}

/**
 * Issue a GET against `url`, following up to `maxRedirects` 3xx hops. Resolves
 * with the response stream on a 2xx or rejects on any other terminal status.
 * Honors the supplied AbortSignal at every step.
 */
function httpsGetWithRedirects(
  url: string,
  signal: AbortSignal | undefined,
  maxRedirects = 5
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string, redirectsLeft: number): void => {
      let onAbort: (() => void) | null = null;
      const detachAbort = (): void => {
        if (onAbort) signal?.removeEventListener("abort", onAbort);
        onAbort = null;
      };
      const req = https.get(currentUrl, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          detachAbort();
          if (redirectsLeft <= 0) {
            res.resume();
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          res.resume();
          const next = new URL(res.headers.location, currentUrl).toString();
          request(next, redirectsLeft - 1);
          return;
        }
        if (status !== 200) {
          detachAbort();
          res.resume();
          reject(new Error(`HTTP ${status} fetching ${currentUrl}`));
          return;
        }
        // Hand the response off without detaching: the consumer may still
        // need to abort mid-stream. Cleanup happens on res 'close'/'end'.
        res.on("close", detachAbort);
        resolve(res);
      });
      req.on("error", (e) => {
        detachAbort();
        reject(e);
      });
      if (signal) {
        if (signal.aborted) {
          req.destroy(new AbortError());
        } else {
          onAbort = (): void => {
            req.destroy(new AbortError());
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    };
    request(url, maxRedirects);
  });
}

/**
 * Stream a remote asset to `dest`, emitting progress events and aborting if
 * no bytes arrive for `DOWNLOAD_INACTIVITY_TIMEOUT_MS`. Stalled connections
 * surface a clear "download stalled" error instead of hanging forever.
 */
async function downloadToFile(
  url: string,
  dest: string,
  expectedSize: number | undefined,
  opts: InstallPipelineOptions
): Promise<void> {
  const assetName = path.basename(dest);
  const res = await httpsGetWithRedirects(url, opts.signal);
  const total =
    expectedSize ??
    (res.headers["content-length"] ? Number(res.headers["content-length"]) : undefined);

  let received = 0;
  let stalled = false;
  let inactivityTimer: number | null = null;
  const out = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    const clearInactivity = (): void => {
      if (inactivityTimer) {
        window.clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    };
    const armInactivity = (): void => {
      clearInactivity();
      inactivityTimer = window.setTimeout(() => {
        stalled = true;
        res.destroy(
          new Error(
            `Download stalled — no bytes received for ${Math.round(DOWNLOAD_INACTIVITY_TIMEOUT_MS / 1000)}s. Check your network and retry.`
          )
        );
      }, DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    };
    armInactivity();
    res.on("data", (chunk: Uint8Array) => {
      received += chunk.length;
      armInactivity();
      opts.onProgress?.({ phase: "download", received, total, assetName });
    });
    const fail = (e: Error): void => {
      clearInactivity();
      reject(e);
    };
    res.on("error", fail);
    out.on("error", fail);
    out.on("finish", () => {
      clearInactivity();
      if (stalled) return; // already rejected via res.destroy()
      resolve();
    });
    res.pipe(out);
  });
}

/**
 * Extract `archivePath` into `destDir` by shelling out to the system `tar`
 * (bsdtar on Windows 10 1803+). Distinguishes "tar not found" from
 * non-zero exits so the user gets actionable error text.
 *
 * Path-traversal note: both GNU tar and bsdtar strip leading `/` and refuse
 * to follow `..` outside the extraction root by default, so a malicious
 * archive cannot escape `destDir`. We rely on that default rather than
 * re-implementing extraction in JS.
 */
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  // Cross-platform: macOS and Linux ship `tar`; Windows 10 1803+ ships `tar.exe`
  // built in (`bsdtar`), which handles .zip / .tar.gz / .tar.xz transparently.
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-xf", archivePath, "-C", destDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d: Uint8Array) => {
      stderr += Buffer.from(d).toString();
    });
    proc.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        reject(
          new Error(
            "`tar` was not found on PATH. macOS/Linux ship it by default; on Windows you need 10 1803+ (which ships `tar.exe`/bsdtar) or to install bsdtar manually."
          )
        );
      } else {
        reject(new Error(`Failed to launch tar: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

// BFS because the binary's depth inside the upstream archive varies across
// opencode releases — first match wins.
async function locateFile(root: string, name: string): Promise<string> {
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
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
