import type { MiyoHealthResponse } from "@/miyo/miyoHealth";
import type { CopilotSettings } from "@/settings/model";

const mockFetchHealth = jest.fn<Promise<MiyoHealthResponse | null>, [string?]>();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    fetchHealth: (url?: string) => mockFetchHealth(url),
  })),
}));

const mockGetSettings = jest.fn<CopilotSettings, []>();
let settingsSubscriber: ((prev: CopilotSettings, next: CopilotSettings) => void) | null = null;

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  subscribeToSettingsChange: (cb: (prev: CopilotSettings, next: CopilotSettings) => void) => {
    settingsSubscriber = cb;
    return () => {
      settingsSubscriber = null;
    };
  },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type Store = typeof import("@/miyo/miyoStatusStore");

function loadStore(): Store {
  let store!: Store;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require to get a fresh module instance per test
    store = require("@/miyo/miyoStatusStore") as Store;
  });
  return store;
}

const okHealth = (over: Partial<MiyoHealthResponse> = {}): MiyoHealthResponse => ({
  status: "ok",
  ...over,
});

const enabledSettings = (over: Partial<CopilotSettings> = {}): CopilotSettings =>
  ({ enableMiyo: true, miyoServerUrl: "", ...over }) as CopilotSettings;

function deferredHealth(): {
  promise: Promise<MiyoHealthResponse>;
  resolve: (value: MiyoHealthResponse) => void;
} {
  let resolve!: (value: MiyoHealthResponse) => void;
  const promise = new Promise<MiyoHealthResponse>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("miyoStatusStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsSubscriber = null;
    mockGetSettings.mockReturnValue(enabledSettings());
  });

  describe("refreshMiyoStatus()", () => {
    it("maps a full healthy payload with idle chat sync to per-capability available", async () => {
      mockFetchHealth.mockResolvedValue(
        okHealth({ relay: { status: "connected" }, chat_sync: { configured: true, active: false } })
      );
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.backend).toBe("available");
      expect(snap.connector).toBe("available");
      expect(snap.chatSync).toBe("available");
      expect(snap.documentProcessor).toBe("available");
      expect(snap.source).toBe("fresh");
    });

    it("reports unconfigured chat sync as unavailable", async () => {
      mockFetchHealth.mockResolvedValue(
        okHealth({ chat_sync: { configured: false, active: false } })
      );
      const store = loadStore();

      expect((await store.refreshMiyoStatus()).chatSync).toBe("unavailable");
    });

    it("reports chatSync syncing when any platform is syncing", async () => {
      mockFetchHealth.mockResolvedValue(
        okHealth({
          chat_sync: {
            configured: true,
            active: true,
            platforms: { chatgpt: { syncing: false }, claude_ai: { syncing: true } },
          },
        })
      );
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.chatSync).toBe("syncing");
    });

    it("degrades only the connector when relay is absent (unknown, not off)", async () => {
      mockFetchHealth.mockResolvedValue(
        okHealth({ chat_sync: { configured: true, active: true } })
      );
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.connector).toBe("unknown");
      expect(snap.chatSync).toBe("available");
      expect(snap.backend).toBe("available");
    });

    it("maps a disconnected relay to unavailable", async () => {
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "disconnected" } }));
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.connector).toBe("unavailable");
    });

    it("keeps the connector unknown while relay reports an indeterminate status", async () => {
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "unknown" } }));
      const store = loadStore();
      expect((await store.refreshMiyoStatus()).connector).toBe("unknown");

      mockFetchHealth.mockResolvedValue(okHealth({ relay: {} }));
      expect((await loadStore().refreshMiyoStatus()).connector).toBe("unknown");
    });

    it("degrades every capability except backend to unknown when health is unreachable", async () => {
      mockFetchHealth.mockResolvedValue(null);
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.backend).toBe("unavailable");
      expect(snap.connector).toBe("unknown");
      expect(snap.chatSync).toBe("unknown");
      expect(snap.documentProcessor).toBe("unknown");
    });

    it("treats a non-ok health status as unavailable (consistent with isBackendAvailable)", async () => {
      mockFetchHealth.mockResolvedValue({ status: "error", relay: { status: "connected" } });
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(snap.backend).toBe("unavailable");
      expect(snap.connector).toBe("unknown");
      expect(snap.documentProcessor).toBe("unknown");
    });

    it("probes the saved remote server address when Miyo is configured for a remote server", async () => {
      mockGetSettings.mockReturnValue(
        enabledSettings({ miyoConnectionMode: "remote", miyoServerUrl: "http://remote:8742" })
      );
      mockFetchHealth.mockResolvedValue(okHealth());

      await loadStore().refreshMiyoStatus();

      expect(mockFetchHealth).toHaveBeenCalledWith("http://remote:8742");
    });

    it("does not fetch and stays all-unknown when Miyo is disabled", async () => {
      mockGetSettings.mockReturnValue(enabledSettings({ enableMiyo: false }));
      const store = loadStore();
      const snap = await store.refreshMiyoStatus();
      expect(mockFetchHealth).not.toHaveBeenCalled();
      expect(snap.backend).toBe("unknown");
      expect(store.isMiyoAvailableForCapability("documentProcessor")).toBe(false);
    });

    it("does not subscribe to settings on import; registers lazily on first refresh", async () => {
      mockFetchHealth.mockResolvedValue(okHealth());
      const store = loadStore();
      expect(settingsSubscriber).toBeNull();

      await store.refreshMiyoStatus();
      expect(settingsSubscriber).not.toBeNull();
    });

    it("dedupes concurrent refreshes onto one fetch", async () => {
      const pending = deferredHealth();
      mockFetchHealth.mockReturnValue(pending.promise);
      const store = loadStore();
      const a = store.refreshMiyoStatus();
      const b = store.refreshMiyoStatus();
      pending.resolve(okHealth());
      await Promise.all([a, b]);
      expect(mockFetchHealth).toHaveBeenCalledTimes(1);
    });

    it("serves cache within the TTL without a second fetch", async () => {
      mockFetchHealth.mockResolvedValue(okHealth());
      const store = loadStore();
      await store.refreshMiyoStatus();
      await store.refreshMiyoStatus();
      expect(mockFetchHealth).toHaveBeenCalledTimes(1);
    });

    it("re-fetches when force is set", async () => {
      mockFetchHealth.mockResolvedValue(okHealth());
      const store = loadStore();
      await store.refreshMiyoStatus();
      await store.refreshMiyoStatus({ force: true });
      expect(mockFetchHealth).toHaveBeenCalledTimes(2);
    });
  });

  describe("getMiyoStatusSnapshot()", () => {
    it("starts all-unknown with no fetch", () => {
      const store = loadStore();
      const snap = store.getMiyoStatusSnapshot();
      expect(snap).toMatchObject({
        backend: "unknown",
        connector: "unknown",
        chatSync: "unknown",
        documentProcessor: "unknown",
        checkedAt: null,
        source: "none",
      });
      expect(mockFetchHealth).not.toHaveBeenCalled();
    });

    it("downgrades available capabilities to stale past the stale horizon", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(0);
        mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
        const store = loadStore();
        await store.refreshMiyoStatus();
        expect(store.getMiyoStatusSnapshot().connector).toBe("available");

        jest.setSystemTime(120_000);
        const stale = store.getMiyoStatusSnapshot();
        expect(stale.backend).toBe("stale");
        expect(stale.connector).toBe("stale");
        expect(store.isMiyoAvailableForCapability("connector")).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("returns a referentially stable stale snapshot across reads", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(0);
        mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
        const store = loadStore();
        await store.refreshMiyoStatus();
        jest.setSystemTime(120_000);
        expect(store.getMiyoStatusSnapshot()).toBe(store.getMiyoStatusSnapshot());
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("isMiyoAvailableForCapability()", () => {
    it("is true only for available capabilities", async () => {
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "disconnected" } }));
      const store = loadStore();
      await store.refreshMiyoStatus();
      expect(store.isMiyoAvailableForCapability("backend")).toBe(true);
      expect(store.isMiyoAvailableForCapability("connector")).toBe(false);
      expect(store.isMiyoAvailableForCapability("chatSync")).toBe(false);
    });
  });

  describe("subscribeMiyoStatus()", () => {
    it("notifies subscribers when a refresh lands a new snapshot", async () => {
      mockFetchHealth.mockResolvedValue(okHealth());
      const store = loadStore();
      const listener = jest.fn();
      store.subscribeMiyoStatus(listener);

      await store.refreshMiyoStatus();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops notifying a subscriber after it unsubscribes", async () => {
      mockFetchHealth.mockResolvedValue(okHealth());
      const store = loadStore();
      const listener = jest.fn();
      const unsubscribe = store.subscribeMiyoStatus(listener);
      unsubscribe();

      await store.refreshMiyoStatus();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("invalidateMiyoStatus()", () => {
    it("resets to empty and notifies subscribers", async () => {
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
      const store = loadStore();
      await store.refreshMiyoStatus();
      const listener = jest.fn();
      store.subscribeMiyoStatus(listener);

      store.invalidateMiyoStatus();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.getMiyoStatusSnapshot().backend).toBe("unknown");
    });

    it("drops an in-flight refresh result when invalidated mid-flight", async () => {
      const pendingFetch = deferredHealth();
      mockFetchHealth.mockReturnValue(pendingFetch.promise);
      const store = loadStore();
      const pending = store.refreshMiyoStatus();

      store.invalidateMiyoStatus();

      pendingFetch.resolve(okHealth({ relay: { status: "connected" } }));
      await pending;

      expect(store.getMiyoStatusSnapshot().backend).toBe("unknown");
      expect(store.getMiyoStatusSnapshot().connector).toBe("unknown");
    });

    it("starts a fresh fetch after invalidation instead of reusing the stale in-flight request", async () => {
      const firstFetch = deferredHealth();
      mockFetchHealth.mockReturnValueOnce(firstFetch.promise);
      const store = loadStore();
      const first = store.refreshMiyoStatus();

      store.invalidateMiyoStatus();

      mockFetchHealth.mockResolvedValueOnce(okHealth({ relay: { status: "connected" } }));
      const second = await store.refreshMiyoStatus();

      firstFetch.resolve(okHealth({ relay: { status: "disconnected" } }));
      await first;

      expect(mockFetchHealth).toHaveBeenCalledTimes(2);
      expect(second.backend).toBe("available");
      expect(store.getMiyoStatusSnapshot().backend).toBe("available");
      expect(store.getMiyoStatusSnapshot().connector).toBe("available");
    });

    it("runs automatically when the Miyo server address setting changes", async () => {
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
      const store = loadStore();
      await store.refreshMiyoStatus();
      expect(store.getMiyoStatusSnapshot().backend).toBe("available");

      settingsSubscriber?.(
        enabledSettings(),
        enabledSettings({ miyoConnectionMode: "remote", miyoServerUrl: "http://remote:1" })
      );

      expect(store.getMiyoStatusSnapshot().backend).toBe("unknown");
    });
  });
});
