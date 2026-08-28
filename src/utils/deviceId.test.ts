import type { App } from "obsidian";

const STORAGE_KEY = "obsidian-copilot:device-id:v1";

async function loadFreshGetDeviceId(): Promise<(app: App) => string> {
  jest.resetModules();
  const mod = await import("@/utils/deviceId");
  return mod.getDeviceId;
}

/** Minimal stand-in for Obsidian's vault-scoped device-local storage. */
function createFakeApp(store = new Map<string, string>()) {
  const app = {
    loadLocalStorage: jest.fn((key: string): unknown => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, data: unknown): void => {
      // Production code only ever stores strings, so the fake narrows directly.
      if (data == null) store.delete(key);
      else store.set(key, data as string);
    }),
  };
  return { app: app as unknown as App, store };
}

/** App whose storage methods throw, as when the API is unusable. */
function createThrowingApp(): App {
  return {
    loadLocalStorage: () => {
      throw new Error("restricted");
    },
    saveLocalStorage: () => {
      throw new Error("restricted");
    },
  } as unknown as App;
}

/** App whose reads work but whose writes are silently dropped, mirroring
 *  Obsidian's swallow-on-failure `saveLocalStorage` over broken storage. */
function createDroppedWriteApp(store = new Map<string, string>()): App {
  return {
    loadLocalStorage: (key: string): unknown => store.get(key) ?? null,
    saveLocalStorage: jest.fn(),
  } as unknown as App;
}

describe("deviceId", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("getDeviceId()", () => {
    it("generates a stable, non-empty id and persists it to vault-scoped storage", async () => {
      const getDeviceId = await loadFreshGetDeviceId();
      const { app, store } = createFakeApp();

      const first = getDeviceId(app);

      expect(typeof first).toBe("string");
      expect(first.length).toBeGreaterThan(0);
      expect(getDeviceId(app)).toBe(first);
      expect(store.get(STORAGE_KEY)).toBe(first);
    });

    it("reuses an id already present in vault-scoped storage", async () => {
      const getDeviceId = await loadFreshGetDeviceId();
      const { app } = createFakeApp(new Map([[STORAGE_KEY, "preset-device-id"]]));

      expect(getDeviceId(app)).toBe("preset-device-id");
    });

    it("ignores an expired raw-storage value when vault-scoped storage is empty (https://github.com/Brevilabs/obsidian-copilot-private/issues/246)", async () => {
      window.localStorage.setItem(STORAGE_KEY, "expired-device-id");
      const getDeviceId = await loadFreshGetDeviceId();
      const { app, store } = createFakeApp();

      const id = getDeviceId(app);
      expect(id).not.toBe("expired-device-id");
      expect(store.get(STORAGE_KEY)).toBe(id);
      // The expired browser key is ignored rather than mutated.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/246
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("expired-device-id");
    });

    it("generates distinct ids for distinct vault stores (fresh module instances)", async () => {
      const getDeviceIdA = await loadFreshGetDeviceId();
      const a = getDeviceIdA(createFakeApp().app);
      const getDeviceIdB = await loadFreshGetDeviceId();
      const b = getDeviceIdB(createFakeApp().app);

      expect(a).not.toBe(b);
    });

    it("falls back to a stable sentinel when storage access throws", async () => {
      const getDeviceId = await loadFreshGetDeviceId();
      const app = createThrowingApp();

      expect(getDeviceId(app)).toBe("unknown");
      // Cached for the session: a second call stays stable without re-touching storage.
      expect(getDeviceId(app)).toBe("unknown");
    });

    it("falls back to a stable sentinel when writes are silently dropped", async () => {
      const getDeviceId = await loadFreshGetDeviceId();

      expect(getDeviceId(createDroppedWriteApp())).toBe("unknown");
    });
  });
});
