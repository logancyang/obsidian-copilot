/**
 * Lazy downloader for the `models.dev` catalog.
 *
 * Two-tier read path:
 *   1. Memory cache (populated by `ensureLoaded` or `refresh`).
 *   2. Disk cache at `<vault>/.copilot/model-catalog-cache.json`,
 *      alongside the plugin's other disposable runtime caches.
 *
 * `ensureLoaded` reads disk first. If the cached payload is younger
 * than 24h it's used as-is — no network call. Otherwise (stale or
 * missing) it triggers a `refresh` automatically. A stale-disk
 * fallback covers network failure so offline launches still surface
 * something. `refresh` stays public for the manual "Refresh catalog"
 * button the BYOK panel will add.
 *
 * The service is **module-internal** — only the BYOK settings panel
 * (also in `src/modelManagement/`) instantiates it. Plugin boot does
 * not import or call it, so opening Obsidian never hits models.dev.
 */

import type { App, RequestUrlResponse } from "obsidian";
import { normalizePath, requestUrl } from "obsidian";

import { logError, logInfo, logWarn } from "@/logger";

import type { CatalogProvider } from "@/modelManagement/types/catalog";
import { transformWireToCatalog } from "./catalogTransform";
import { isPlainObject } from "./modelsDevWire";

// Sits with the other disposable caches under `.copilot/`
// (see fileCache / pdfCache / projectContextCache).
const CACHE_DIR = ".copilot";
const CACHE_FILENAME = "model-catalog-cache.json";
const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 5000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_ATTEMPTS = 3;

export interface CatalogRefreshResult {
  ok: boolean;
  providerCount: number;
  error?: string;
}

interface DiskPayload {
  fetchedAt: number;
  data: unknown;
}

export interface CatalogDownloadDeps {
  app: App;
}

type Listener = () => void;

export class CatalogDownloadService {
  private readonly app: App;
  private readonly cachePath: string;
  private readonly listeners = new Set<Listener>();

  private providers: CatalogProvider[] = [];
  private byId = new Map<string, CatalogProvider>();
  private loadPromise: Promise<void> | null = null;
  private refreshPromise: Promise<CatalogRefreshResult> | null = null;
  private failedAutoAttempts = 0;

  constructor(deps: CatalogDownloadDeps) {
    this.app = deps.app;
    this.cachePath = normalizePath(`${CACHE_DIR}/${CACHE_FILENAME}`);
  }

  /**
   * Idempotent: concurrent callers share the first invocation's promise.
   * Reads disk first, auto-refreshes when the cached payload is older
   * than 24h or absent. If a network refresh is attempted but produces
   * zero providers the cached promise is cleared so the next call
   * retries — up to `MAX_AUTO_ATTEMPTS` total. After that we stop
   * hammering models.dev; the manual `refresh()` button stays as the
   * recovery path and resets the counter on success. A fresh-but-empty
   * disk cache (no network attempted) does NOT count against the cap —
   * otherwise a benignly-empty disk would poison auto-refresh.
   */
  ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    if (this.providers.length === 0 && this.failedAutoAttempts >= MAX_AUTO_ATTEMPTS) {
      return Promise.resolve();
    }
    this.loadPromise = this.doEnsureLoaded().then(
      ({ attemptedRefresh }) => {
        if (this.providers.length === 0) {
          this.loadPromise = null;
          if (attemptedRefresh) {
            this.failedAutoAttempts += 1;
            if (this.failedAutoAttempts >= MAX_AUTO_ATTEMPTS) {
              logWarn(
                `[modelsCatalog] giving up auto-refresh after ${MAX_AUTO_ATTEMPTS} empty attempts; use the manual Refresh button to retry`
              );
            }
          }
        } else {
          this.failedAutoAttempts = 0;
        }
      },
      (err) => {
        this.loadPromise = null;
        throw err;
      }
    );
    return this.loadPromise;
  }

  /**
   * User-triggered live fetch. On success the disk cache is rewritten,
   * memory is swapped, and `onChange` listeners fire. On failure
   * memory is left untouched. Single-flighted: concurrent invocations
   * (e.g. ensureLoaded racing the manual "Refresh catalog" button)
   * share one in-flight fetch rather than racing the cache write.
   */
  refresh(): Promise<CatalogRefreshResult> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<CatalogRefreshResult> {
    let response: RequestUrlResponse;
    try {
      response = await this.fetchWithTimeout();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[modelsCatalog] refresh failed: ${message}`);
      return { ok: false, providerCount: 0, error: message };
    }

    if (response.status < 200 || response.status >= 300) {
      const message = `models.dev responded with status ${response.status}`;
      logWarn(`[modelsCatalog] refresh failed: ${message}`);
      return { ok: false, providerCount: 0, error: message };
    }

    let parsed: unknown;
    try {
      parsed = typeof response.json === "string" ? JSON.parse(response.json) : response.json;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[modelsCatalog] refresh failed: invalid JSON: ${message}`);
      return { ok: false, providerCount: 0, error: `invalid JSON: ${message}` };
    }

    if (!isPlainObject(parsed)) {
      logWarn("[modelsCatalog] refresh failed: payload is not an object");
      return { ok: false, providerCount: 0, error: "payload is not an object" };
    }
    // From here on the transform handles per-entry validation.

    const fetchedAt = Date.now();
    try {
      if (!(await this.app.vault.adapter.exists(CACHE_DIR))) {
        await this.app.vault.adapter.mkdir(CACHE_DIR);
      }
      const payload: DiskPayload = { fetchedAt, data: parsed };
      await this.app.vault.adapter.write(this.cachePath, JSON.stringify(payload));
    } catch (err) {
      // Disk write failure is non-fatal; memory still gets populated.
      logError("[modelsCatalog] failed to write disk cache", err);
    }

    this.swapMemory(parsed);
    this.failedAutoAttempts = 0;
    this.emit();
    logInfo(`[modelsCatalog] refreshed: ${this.providers.length} providers`);
    return { ok: true, providerCount: this.providers.length };
  }

  /**
   * Returns a copy so callers can sort/splice their view without
   * corrupting service state.
   */
  getAllProviders(): readonly CatalogProvider[] {
    return [...this.providers];
  }

  getProvider(id: string): CatalogProvider | undefined {
    return this.byId.get(id);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async doEnsureLoaded(): Promise<{ attemptedRefresh: boolean }> {
    const disk = await this.readDisk();

    // Race guard: a concurrent manual refresh may have populated memory
    // while we were reading disk. Don't clobber live data with an older
    // disk snapshot.
    if (this.providers.length > 0) {
      return { attemptedRefresh: false };
    }

    if (disk && Date.now() - disk.fetchedAt < STALE_AFTER_MS) {
      this.swapMemory(disk.data);
      logInfo(`[modelsCatalog] loaded from disk: ${this.providers.length} providers`);
      return { attemptedRefresh: false };
    }

    const result = await this.refresh();
    if (!result.ok && disk && this.providers.length === 0) {
      // Network failed but we have stale data — surface it so the UI
      // isn't empty offline. The `length === 0` guard avoids clobbering
      // memory another caller populated during the await.
      this.swapMemory(disk.data);
      logInfo(
        `[modelsCatalog] refresh failed; falling back to stale disk cache (${this.providers.length} providers)`
      );
    }
    return { attemptedRefresh: true };
  }

  private async readDisk(): Promise<DiskPayload | null> {
    try {
      if (!(await this.app.vault.adapter.exists(this.cachePath))) return null;
      const raw = await this.app.vault.adapter.read(this.cachePath);
      const parsed = JSON.parse(raw) as Partial<DiskPayload>;
      if (!parsed || typeof parsed.fetchedAt !== "number" || !isPlainObject(parsed.data)) {
        logWarn("[modelsCatalog] disk cache rejected: malformed payload");
        return null;
      }
      return { fetchedAt: parsed.fetchedAt, data: parsed.data };
    } catch (err) {
      logWarn(
        `[modelsCatalog] disk cache read failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  private fetchWithTimeout(): Promise<RequestUrlResponse> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(`models.dev fetch timed out after ${FETCH_TIMEOUT_MS}ms`));
      }, FETCH_TIMEOUT_MS);

      requestUrl({ url: MODELS_DEV_URL, method: "GET", throw: false }).then(
        (response) => {
          window.clearTimeout(timer);
          resolve(response);
        },
        (err: unknown) => {
          window.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }

  private swapMemory(wire: unknown): void {
    this.providers = transformWireToCatalog(wire);
    this.byId = new Map(this.providers.map((p) => [p.id, p]));
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        logError("[modelsCatalog] onChange listener threw", err);
      }
    }
  }
}
