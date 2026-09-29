import type { App, RequestUrlResponse } from "obsidian";
import { normalizePath, requestUrl } from "obsidian";

import { logError, logInfo, logWarn } from "@/logger";

import type { CatalogProvider } from "@/modelManagement/types/catalog";
import { transformWireToCatalog } from "./catalogTransform";
import { isPlainObject } from "./modelsDevWire";

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

    const fetchedAt = Date.now();
    try {
      if (!(await this.app.vault.adapter.exists(CACHE_DIR))) {
        await this.app.vault.adapter.mkdir(CACHE_DIR);
      }
      const payload: DiskPayload = { fetchedAt, data: parsed };
      await this.app.vault.adapter.write(this.cachePath, JSON.stringify(payload));
    } catch (err) {
      logError("[modelsCatalog] failed to write disk cache", err);
    }

    this.swapMemory(parsed);
    this.failedAutoAttempts = 0;
    this.emit();
    logInfo(`[modelsCatalog] refreshed: ${this.providers.length} providers`);
    return { ok: true, providerCount: this.providers.length };
  }

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
