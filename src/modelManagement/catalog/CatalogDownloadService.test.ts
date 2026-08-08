jest.mock("@/settings/model", () => ({
  getSettings: () => ({ debug: false }),
}));

// Mock `obsidian.requestUrl` so the service never makes a real HTTP call.
// The global `__mocks__/obsidian.js` wrapper-based pattern doesn't survive
// dual-instance module loading reliably; inline mocking is more robust.
jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
  normalizePath: (p: string) => String(p).replace(/\/+/g, "/"),
}));

import { requestUrl, type RequestUrlParam, type RequestUrlResponse, type App } from "obsidian";

import type { CatalogProvider } from "@/modelManagement/types/catalog";

import { CatalogDownloadService } from "./CatalogDownloadService";
import type { WireCatalog } from "./modelsDevWire";

const mockedRequestUrl = requestUrl as unknown as jest.Mock<
  Promise<RequestUrlResponse>,
  [RequestUrlParam]
>;

const CACHE_DIR = ".copilot";
const CACHE_PATH = `${CACHE_DIR}/model-catalog-cache.json`;

const FIXTURE: WireCatalog = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    api: "https://api.anthropic.com/v1",
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        tool_call: true,
        reasoning: true,
        limit: { context: 200000, output: 64000 },
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    models: { "gpt-5": { id: "gpt-5", name: "GPT-5" } },
  },
  helicone: {
    id: "helicone",
    name: "Helicone",
    npm: "@ai-sdk/openai-compatible",
    api: "https://ai-gateway.helicone.ai/v1",
    models: {},
  },
};

type AdapterMock = {
  read: jest.Mock<Promise<string>, [string]>;
  write: jest.Mock<Promise<void>, [string, string]>;
  exists: jest.Mock<Promise<boolean>, [string]>;
  mkdir: jest.Mock<Promise<void>, [string]>;
};

function buildFakeApp(adapter: AdapterMock): App {
  return { vault: { adapter } } as unknown as App;
}

function buildAdapter(initial?: { fetchedAt: number; data: WireCatalog }): AdapterMock {
  let stored = initial ? JSON.stringify(initial) : null;
  let dirExists = false;
  // Path-aware: the `.copilot` dir existence is tracked separately from
  // the cache file, which keys off whether anything has been written.
  const exists: AdapterMock["exists"] = jest.fn((path: string) =>
    Promise.resolve(path === CACHE_DIR ? dirExists : stored !== null)
  );
  const read: AdapterMock["read"] = jest.fn((_path: string) => {
    if (stored === null) throw new Error("not found");
    return Promise.resolve(stored);
  });
  const write: AdapterMock["write"] = jest.fn((_path: string, contents: string) => {
    stored = contents;
    return Promise.resolve();
  });
  const mkdir: AdapterMock["mkdir"] = jest.fn((_path: string) => {
    dirExists = true;
    return Promise.resolve();
  });
  return { exists, read, write, mkdir };
}

function okResponse(json: unknown): RequestUrlResponse {
  return {
    status: 200,
    text: typeof json === "string" ? json : JSON.stringify(json),
    json,
    arrayBuffer: new ArrayBuffer(0),
    headers: {},
  };
}

/** Pin `Date.now()` for the lifetime of a test. */
function freezeNow(timestamp: number): jest.SpyInstance<number, []> {
  return jest.spyOn(Date, "now").mockReturnValue(timestamp);
}

describe("CatalogDownloadService", () => {
  const FIXED_NOW = 1_700_000_000_000;

  let nowSpy: jest.SpyInstance<number, []> | null = null;

  beforeEach(() => {
    mockedRequestUrl.mockReset();
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
    jest.useRealTimers();
  });

  it("loads from disk without fetching when cache is fresh (<24h)", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter({ fetchedAt: FIXED_NOW - 60 * 60 * 1000, data: FIXTURE });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    expect(mockedRequestUrl).not.toHaveBeenCalled();
    expect(adapter.read).toHaveBeenCalledWith(CACHE_PATH);
    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);
    expect(svc.getProvider("anthropic")?.providerType).toBe("anthropic");
  });

  it("refreshes when disk cache is stale (>24h)", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const STALE_BY = 25 * 60 * 60 * 1000;
    const adapter = buildAdapter({ fetchedAt: FIXED_NOW - STALE_BY, data: { foo: { id: "foo" } } });
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://models.dev/api.json", method: "GET" })
    );
    expect(adapter.write).toHaveBeenCalledTimes(1);
    const written = JSON.parse(adapter.write.mock.calls[0][1]) as {
      fetchedAt: number;
      data: WireCatalog;
    };
    expect(written.fetchedAt).toBe(FIXED_NOW);
    expect(Object.keys(written.data)).toEqual(["anthropic", "openai", "helicone"]);
    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);
  });

  it("falls back to stale disk data when refresh fails", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const STALE_BY = 48 * 60 * 60 * 1000;
    const adapter = buildAdapter({ fetchedAt: FIXED_NOW - STALE_BY, data: FIXTURE });
    mockedRequestUrl.mockResolvedValue({ ...okResponse(null), status: 500, json: undefined });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);
  });

  it("triggers a refresh when no disk cache exists", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(svc.getAllProviders().length).toBe(3);
  });

  it("leaves memory empty when no disk cache exists and refresh fails", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue({ ...okResponse(null), status: 500, json: undefined });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    expect(svc.getAllProviders()).toEqual([]);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("caps auto-retry at 3 ensureLoaded() attempts; manual refresh() still works after", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue({ ...okResponse(null), status: 500, json: undefined });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    expect(mockedRequestUrl).toHaveBeenCalledTimes(3);

    // 4th, 5th calls: gave up, no network hit.
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    expect(mockedRequestUrl).toHaveBeenCalledTimes(3);

    // Manual refresh recovers and resets the counter.
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    const result = await svc.refresh();
    expect(result.ok).toBe(true);
    expect(svc.getAllProviders().length).toBe(3);

    // Subsequent ensureLoaded() also works (counter reset).
    await svc.ensureLoaded();
    expect(svc.getAllProviders().length).toBe(3);
  });

  it("retries on the next ensureLoaded() after an empty first-load failure", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    // First attempt: network failure.
    mockedRequestUrl.mockResolvedValueOnce({ ...okResponse(null), status: 500, json: undefined });
    // Second attempt: success.
    mockedRequestUrl.mockResolvedValueOnce(okResponse(FIXTURE));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();
    expect(svc.getAllProviders()).toEqual([]);

    await svc.ensureLoaded();
    expect(svc.getAllProviders().length).toBe(3);
    expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent ensureLoaded() calls", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter({ fetchedAt: FIXED_NOW - 60 * 1000, data: FIXTURE });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await Promise.all([svc.ensureLoaded(), svc.ensureLoaded(), svc.ensureLoaded()]);

    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(mockedRequestUrl).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent refresh() calls", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    let resolveFetch: ((r: RequestUrlResponse) => void) | null = null;
    mockedRequestUrl.mockImplementation(
      () =>
        new Promise<RequestUrlResponse>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const pending = Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    // All three share the same in-flight fetch.
    expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

    resolveFetch!(okResponse(FIXTURE));
    const results = await pending;

    expect(results.every((r) => r.ok)).toBe(true);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  it("refresh() returns ok:false on HTTP 500 and leaves memory untouched", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue({ ...okResponse(null), status: 500 });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const result = await svc.refresh();

    expect(result.ok).toBe(false);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(svc.getAllProviders()).toEqual([]);
  });

  it("refresh() rejects non-object payloads", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue(okResponse([1, 2, 3]));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const result = await svc.refresh();

    expect(result.ok).toBe(false);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("refresh() rejects when JSON parse throws", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      text: "not json",
      json: "not json",
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const result = await svc.refresh();

    expect(result.ok).toBe(false);
  });

  it("refresh() times out after 5s when requestUrl hangs", async () => {
    jest.useFakeTimers();
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockReturnValue(new Promise(() => {}));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const pending = svc.refresh();
    jest.advanceTimersByTime(5000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("fires onChange listeners on successful refresh; unsubscribed listeners stay silent", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter();
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    const subscribed = jest.fn();
    const unsubscribedAt = jest.fn();
    const stop = svc.onChange(unsubscribedAt);
    svc.onChange(subscribed);
    stop();

    await svc.refresh();

    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(unsubscribedAt).not.toHaveBeenCalled();
  });

  it("does not poison the auto-retry counter when a fresh disk cache transforms to zero providers", async () => {
    // Disk cache exists, fetchedAt is fresh (< 24h), but the wire
    // payload transforms to zero providers (e.g. upstream returned an
    // empty object that we persisted, or partial-write left `{}`). The
    // service should take the fresh-disk branch without ever hitting
    // the network — and crucially the empty result must NOT count
    // against MAX_AUTO_ATTEMPTS, because no refresh was attempted.
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter({
      fetchedAt: FIXED_NOW - 60 * 1000,
      data: {},
    });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    // Five fresh-disk loads — none should touch the network.
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    expect(mockedRequestUrl).not.toHaveBeenCalled();
    expect(svc.getAllProviders()).toEqual([]);

    // If the counter had been ratcheted by the empty-disk loads above,
    // a subsequent ensureLoaded() with a STALE disk would short-circuit
    // and never call requestUrl. Force a stale-disk state and verify
    // refresh is still attempted.
    nowSpy.mockReturnValue(FIXED_NOW + 25 * 60 * 60 * 1000);
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    await svc.ensureLoaded();
    expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    expect(svc.getAllProviders().length).toBe(3);
  });

  it("does not clobber a just-refreshed live snapshot with a slow disk read", async () => {
    // Race scenario: a manual refresh() is in flight; concurrently
    // ensureLoaded() starts and awaits a slow disk read. The HTTP
    // fetch resolves first → memory swaps to live data. Then the disk
    // read returns a (fresh-but-older) snapshot — the fresh-disk
    // branch must NOT clobber live data.
    nowSpy = freezeNow(FIXED_NOW);
    const OLDER_DISK: WireCatalog = {
      stale: {
        id: "stale",
        name: "Stale Provider",
        npm: "@ai-sdk/openai-compatible",
        api: "https://stale.example/v1",
        models: {},
      },
    };
    const adapter = buildAdapter({
      fetchedAt: FIXED_NOW - 60 * 60 * 1000,
      data: OLDER_DISK,
    });
    // Hold the disk read open until we explicitly resolve it.
    let resolveRead: (() => void) | null = null;
    const stored = JSON.stringify({ fetchedAt: FIXED_NOW - 60 * 60 * 1000, data: OLDER_DISK });
    adapter.read.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = () => resolve(stored);
        })
    );
    mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    // Kick off ensureLoaded — it blocks on the disk read.
    const ensurePending = svc.ensureLoaded();
    // Concurrently run a manual refresh — it completes immediately.
    await svc.refresh();
    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);

    // Now let the disk read finish. The fresh-disk branch must see
    // that memory is already populated and bail out without swapping.
    resolveRead!();
    await ensurePending;

    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);
  });

  it("getAllProviders() returns a copy so caller-side mutation can't corrupt internal state", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const adapter = buildAdapter({ fetchedAt: FIXED_NOW - 60 * 1000, data: FIXTURE });
    const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

    await svc.ensureLoaded();

    const snapshot = svc.getAllProviders() as CatalogProvider[];
    expect(snapshot.map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);

    // Mutating the returned array must not affect the next read.
    snapshot.reverse();
    snapshot.pop();

    expect(svc.getAllProviders().map((p) => p.id)).toEqual(["anthropic", "helicone", "openai"]);
  });

  it("never invokes the global fetch", async () => {
    nowSpy = freezeNow(FIXED_NOW);
    const fetchMock = jest.fn(() => {
      throw new Error("global fetch should not be called");
    });
    const target = window as unknown as { fetch?: unknown };
    const original = target.fetch;
    target.fetch = fetchMock;
    try {
      const adapter = buildAdapter();
      mockedRequestUrl.mockResolvedValue(okResponse(FIXTURE));
      const svc = new CatalogDownloadService({ app: buildFakeApp(adapter) });

      await svc.ensureLoaded();

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      target.fetch = original;
    }
  });
});
