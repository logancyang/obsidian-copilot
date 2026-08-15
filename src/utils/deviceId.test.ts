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
      // A freshly generated id never touches the legacy raw key.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("reuses an id already present in vault-scoped storage", async () => {
      const getDeviceId = await loadFreshGetDeviceId();
      const { app } = createFakeApp(new Map([[STORAGE_KEY, "preset-device-id"]]));

      expect(getDeviceId(app)).toBe("preset-device-id");
    });

    it("preserves the legacy device identity during the temporary migration window (https://github.com/logancyang/obsidian-copilot-preview/issues/298)", async () => {
      window.localStorage.setItem(STORAGE_KEY, "legacy-device-id");
      const getDeviceId = await loadFreshGetDeviceId();
      const { app, store } = createFakeApp();

      expect(getDeviceId(app)).toBe("legacy-device-id");
      expect(store.get(STORAGE_KEY)).toBe("legacy-device-id");
      // Left in place: other vaults on this device may not have migrated yet.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("legacy-device-id");
    });

    it("prefers the vault-scoped id over a differing legacy value", async () => {
      window.localStorage.setItem(STORAGE_KEY, "legacy-device-id");
      const getDeviceId = await loadFreshGetDeviceId();
      const { app, store } = createFakeApp(new Map([[STORAGE_KEY, "vault-device-id"]]));

      expect(getDeviceId(app)).toBe("vault-device-id");
      expect(store.get(STORAGE_KEY)).toBe("vault-device-id");
    });

    it("keeps the legacy identity when its forward copy is silently dropped (https://github.com/logancyang/obsidian-copilot-preview/issues/298)", async () => {
      window.localStorage.setItem(STORAGE_KEY, "legacy-device-id");
      const getDeviceId = await loadFreshGetDeviceId();

      // The legacy key survives, so the next launch resolves the same id and
      // retries the copy — the profile segment never detaches.
      expect(getDeviceId(createDroppedWriteApp())).toBe("legacy-device-id");
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
