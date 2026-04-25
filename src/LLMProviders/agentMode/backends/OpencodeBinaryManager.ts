import { OPENCODE_PINNED_VERSION, OPENCODE_RELEASE_API_URL_TEMPLATE } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings, updateSetting } from "@/settings/model";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import { IncomingMessage } from "node:http";
import { FileSystemAdapter, requestUrl } from "obsidian";
import * as path from "node:path";
import { promisify } from "node:util";
import { expectedBinaryName, resolveOpencodeTarget } from "./platformResolver";

const execFileAsync = promisify(execFile);
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000;
// Generous: first-run on Windows (Defender real-time scan) and macOS
// (Gatekeeper translocation) can add a few seconds before the binary responds.
const VERIFY_BINARY_TIMEOUT_MS = 8_000;

export type ProgressEvent =
  | { phase: "resolve"; message: string }
  | { phase: "download"; received: number; total?: number; assetName: string }
  | { phase: "extract"; message: string }
  | { phase: "done"; version: string; path: string };

export interface InstallOptions {
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  /** Override pinned version. Defaults to OPENCODE_PINNED_VERSION. */
  version?: string;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "installed"; version: string; path: string; source: "managed" | "custom" };

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

/** Derive the install state from the persisted `agentMode` settings slice. */
export function computeInstallState(
  agentMode:
    | {
        binaryPath?: string;
        binaryVersion?: string;
        binarySource?: "managed" | "custom";
      }
    | undefined
): InstallState {
  const s = agentMode ?? {};
  if (s.binaryPath && s.binaryVersion) {
    return {
      kind: "installed",
      version: s.binaryVersion,
      path: s.binaryPath,
      source: s.binarySource ?? "managed",
    };
  }
  return { kind: "absent" };
}

// R-M-W on settings is racy with concurrent edits but tolerable: every caller
// is either a one-shot plugin-load reconcile or a user-initiated flow from
// the settings panel, neither of which races with itself.
function updateAgentModeFields(
  partial: Partial<{
    binaryVersion: string | undefined;
    binaryPath: string | undefined;
    binarySource: "managed" | "custom" | undefined;
  }>
): void {
  updateSetting("agentMode", { ...getSettings().agentMode, ...partial });
}

function clearAgentModeBinary(): void {
  updateAgentModeFields({
    binaryVersion: undefined,
    binaryPath: undefined,
    binarySource: undefined,
  });
}

/**
 * Manages the lifecycle of the opencode binary on disk: platform-aware
 * download from GitHub releases, extraction into the plugin data dir, and
 * persistence of the install location into `settings.agentMode`. Desktop-only.
 */
export class OpencodeBinaryManager {
  constructor(private readonly plugin: CopilotPlugin) {}

  getInstallState(): InstallState {
    return computeInstallState(getSettings().agentMode);
  }

  /**
   * Reconcile persisted install state with what's actually on disk. If we
   * believe a managed install exists but the binary is gone (user deleted it,
   * restored a vault from backup, etc.), demote to `absent`. Skipped for
   * custom-source installs — re-checking on every plugin load would punish
   * users for transient filesystem hiccups (network mounts, etc.).
   */
  async refreshInstallState(): Promise<void> {
    const state = this.getInstallState();
    if (state.kind !== "installed") return;
    if (state.source !== "managed") return;
    if (await fileExists(state.path)) return;
    logWarn(`[AgentMode] persisted opencode binary missing at ${state.path}; clearing settings.`);
    clearAgentModeBinary();
  }

  /** Absolute path to `<vault>/.obsidian/plugins/<id>/data/opencode`. */
  getDataDir(): string {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const base = adapter.getBasePath();
    const id = this.plugin.manifest.id;
    return path.join(base, ".obsidian", "plugins", id, "data", "opencode");
  }

  getPinnedVersion(): string {
    return OPENCODE_PINNED_VERSION;
  }

  /**
   * Full install pipeline: resolve target → fetch release metadata →
   * download → extract → atomic rename → persist settings. Idempotent when
   * an existing install matches the pinned manifest.
   */
  async install(opts: InstallOptions = {}): Promise<{ version: string; path: string }> {
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
      const cur = getSettings().agentMode;
      if (
        cur.binaryVersion !== version ||
        cur.binaryPath !== finalBinPath ||
        cur.binarySource !== "managed"
      ) {
        updateAgentModeFields({
          binaryVersion: version,
          binaryPath: finalBinPath,
          binarySource: "managed",
        });
      }
      opts.onProgress?.({ phase: "done", version, path: finalBinPath });
      return { version, path: finalBinPath };
    }

    await fs.promises.mkdir(dataDir, { recursive: true });
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

      updateAgentModeFields({
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
   * Remove the active managed version dir and clear settings. For a custom
   * binary this only clears settings — the binary on disk belongs to the user
   * and we don't touch it. Other version dirs are kept either way.
   */
  async uninstall(): Promise<void> {
    const s = getSettings().agentMode;
    if (s.binarySource === "managed" && s.binaryVersion) {
      const versionDir = path.join(this.getDataDir(), s.binaryVersion);
      await removeDir(versionDir).catch((e) =>
        logError(`[AgentMode] failed to remove ${versionDir}`, e)
      );
    }
    clearAgentModeBinary();
  }

  /**
   * Point Agent Mode at a user-supplied opencode binary. Pass `null` to
   * clear the override (without removing any managed install on disk).
   * Performs filesystem checks plus a `--version` smoke test so misconfigured
   * paths are caught at config time rather than later when ACP tries to boot.
   */
  async setCustomBinaryPath(p: string | null): Promise<void> {
    if (p === null) {
      clearAgentModeBinary();
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
    updateAgentModeFields({ binaryVersion: version, binaryPath: p, binarySource: "custom" });
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

async function renameWithRetry(from: string, to: string, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastErr;
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
  opts: InstallOptions
): Promise<void> {
  const assetName = path.basename(dest);
  const res = await httpsGetWithRedirects(url, opts.signal);
  const total =
    expectedSize ??
    (res.headers["content-length"] ? Number(res.headers["content-length"]) : undefined);

  let received = 0;
  let stalled = false;
  let inactivityTimer: NodeJS.Timeout | null = null;
  const out = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    const clearInactivity = (): void => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    };
    const armInactivity = (): void => {
      clearInactivity();
      inactivityTimer = setTimeout(() => {
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
