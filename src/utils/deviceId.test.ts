import type { App } from "obsidian";
import { validate as validateUuid, version as uuidVersion } from "uuid";

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
    it("generates a stable UUIDv4 and persists it to vault-scoped storage (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const getDeviceId = await loadFreshGetDeviceId();
      const { app, store } = createFakeApp();

      const first = getDeviceId(app);

      expect(typeof first).toBe("string");
      expect(validateUuid(first)).toBe(true);
      expect(uuidVersion(first)).toBe(4);
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

    it("generates distinct ids for distinct vault stores within one module (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const getDeviceIdA = await loadFreshGetDeviceId();
      const a = getDeviceIdA(createFakeApp().app);
      const b = getDeviceIdA(createFakeApp().app);

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

  describe("getPersistedDeviceId()", () => {
    async function loadFreshDeviceIds() {
      jest.resetModules();
      return import("@/utils/deviceId");
    }

    it("persists and reuses the same UUIDv4 used by device settings", async () => {
      const { getDeviceId, getPersistedDeviceId } = await loadFreshDeviceIds();
      const { app, store } = createFakeApp();

      const id = getPersistedDeviceId(app);

      expect(validateUuid(id)).toBe(true);
      expect(uuidVersion(id)).toBe(4);
      expect(store.get(STORAGE_KEY)).toBe(id);
      expect(getDeviceId(app)).toBe(id);
      expect(getPersistedDeviceId(app)).toBe(id);
    });

    it("reuses a persisted UUIDv4 without changing the settings profile key", async () => {
      const { getPersistedDeviceId } = await loadFreshDeviceIds();
      const id = "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f";
      const { app } = createFakeApp(new Map([[STORAGE_KEY, id]]));

      expect(getPersistedDeviceId(app)).toBe(id);
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });

    it("generates a UUIDv4 when crypto.randomUUID is unavailable (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const descriptor = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
      Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: undefined });
      try {
        const { getPersistedDeviceId } = await loadFreshDeviceIds();
        const id = getPersistedDeviceId(createFakeApp().app);
        expect(validateUuid(id)).toBe(true);
        expect(uuidVersion(id)).toBe(4);
      } finally {
        if (descriptor) Object.defineProperty(window.crypto, "randomUUID", descriptor);
        else Reflect.deleteProperty(window.crypto, "randomUUID");
      }
    });

    it.each([
      "legacy-device-id",
      "unknown",
      "3f2a1d9e8b4c4f6d9e2a7c5b3a1d9e8f",
      "2e9c0d84-7f31-11ee-b962-0242ac120002",
    ])(
      "rejects %s without replacing the existing settings identity (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (id) => {
        const { getDeviceId, getPersistedDeviceId } = await loadFreshDeviceIds();
        const { app, store } = createFakeApp(new Map([[STORAGE_KEY, id]]));

        expect(() => getPersistedDeviceId(app)).toThrow();
        expect(getDeviceId(app)).toBe(id);
        expect(store.get(STORAGE_KEY)).toBe(id);
        expect(app.saveLocalStorage).not.toHaveBeenCalled();
      }
    );

    it("rejects unavailable storage instead of returning the settings fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const { getDeviceId, getPersistedDeviceId } = await loadFreshDeviceIds();
      const app = createThrowingApp();

      expect(() => getPersistedDeviceId(app)).toThrow();
      expect(getDeviceId(app)).toBe("unknown");
    });

    it.each(["throw", "discard"])(
      "rejects storage writes that %s instead of returning an ephemeral UUID (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (failure) => {
        const { getPersistedDeviceId } = await loadFreshDeviceIds();
        const { app, store } = createFakeApp();
        jest.mocked(app.saveLocalStorage).mockImplementation(() => {
          if (failure === "throw") throw new Error("restricted");
        });

        expect(() => getPersistedDeviceId(app)).toThrow();
        expect(store.has(STORAGE_KEY)).toBe(false);
      }
    );

    it.each(["throw", "delete", "replace"])(
      "rejects a cached UUID after storage reads %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (failure) => {
        const { getDeviceId, getPersistedDeviceId } = await loadFreshDeviceIds();
        const id = "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f";
        const { app, store } = createFakeApp(new Map([[STORAGE_KEY, id]]));
        expect(getDeviceId(app)).toBe(id);
        if (failure === "throw") {
          jest.mocked(app.loadLocalStorage).mockImplementation(() => {
            throw new Error("restricted");
          });
        } else if (failure === "delete") {
          store.delete(STORAGE_KEY);
        } else {
          store.set(STORAGE_KEY, "da1fc980-4ae4-4dfb-8a34-e1b0bba0b3bc");
        }

        expect(() => getPersistedDeviceId(app)).toThrow();
        expect(getDeviceId(app)).toBe(id);
        expect(app.saveLocalStorage).not.toHaveBeenCalled();
      }
    );
  });
});
