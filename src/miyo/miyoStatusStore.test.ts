import type { MiyoHealthResponse } from "@/miyo/miyoHealth";
import type { CopilotSettings } from "@/settings/model";

// The store constructs a MiyoClient and registers a settings subscription at
// module load, so every collaborator is mocked. Tests reset modules between
// cases to clear the store's module-level snapshot state.
const mockFetchHealth = jest.fn<Promise<MiyoHealthResponse | null>, [string?]>();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    fetchHealth: (url?: string) => mockFetchHealth(url),
  })),
}));

const mockShouldUseMiyo = jest.fn<boolean, [CopilotSettings]>();
const mockGetMiyoCustomUrl = jest.fn<string, [CopilotSettings]>();

jest.mock("@/miyo/miyoRuntimePolicy", () => ({
  shouldUseMiyo: (s: CopilotSettings) => mockShouldUseMiyo(s),
  getMiyoCustomUrl: (s: CopilotSettings) => mockGetMiyoCustomUrl(s),
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

/** Load a fresh copy of the store with its module-level snapshot state reset. */
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

beforeEach(() => {
  jest.clearAllMocks();
  settingsSubscriber = null;
  mockShouldUseMiyo.mockReturnValue(true);
  mockGetMiyoCustomUrl.mockReturnValue("");
  mockGetSettings.mockReturnValue({} as CopilotSettings);
});

describe("module side effects", () => {
  it("does not subscribe to settings on import; registers lazily on first refresh", async () => {
    mockFetchHealth.mockResolvedValue(okHealth());
    const store = loadStore();
    // Importing the store must have no side effect — otherwise the import chain
    // would call subscribeToSettingsChange during unrelated test setup.
    expect(settingsSubscriber).toBeNull();

    await store.refreshMiyoStatus();
    expect(settingsSubscriber).not.toBeNull();
  });
});

describe("getMiyoStatusSnapshot (initial)", () => {
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
});

describe("refreshMiyoStatus health mapping", () => {
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

  it("degrades only the connector when relay is absent (unknown, not off)", async () => {
    mockFetchHealth.mockResolvedValue(okHealth({ chat_sync: { configured: true, active: true } }));
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
    // The Electron app hasn't pushed relay state yet: `status: "unknown"` (or a
    // present-but-status-less relay block) must stay "unknown", never a hard
    // "disconnected"/unavailable.
    mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "unknown" } }));
    const store = loadStore();
    expect((await store.refreshMiyoStatus()).connector).toBe("unknown");

    mockFetchHealth.mockResolvedValue(okHealth({ relay: {} }));
    expect((await loadStore().refreshMiyoStatus()).connector).toBe("unknown");
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
});

describe("enableMiyo gate", () => {
  it("does not fetch and stays all-unknown when Miyo is disabled", async () => {
    mockShouldUseMiyo.mockReturnValue(false);
    const store = loadStore();
    const snap = await store.refreshMiyoStatus();
    expect(mockFetchHealth).not.toHaveBeenCalled();
    expect(snap.backend).toBe("unknown");
    expect(store.isMiyoAvailableForCapability("documentProcessor")).toBe(false);
  });
});

describe("isMiyoAvailableForCapability", () => {
  it("is true only for available capabilities", async () => {
    mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "disconnected" } }));
    const store = loadStore();
    await store.refreshMiyoStatus();
    expect(store.isMiyoAvailableForCapability("backend")).toBe(true);
    expect(store.isMiyoAvailableForCapability("connector")).toBe(false);
    expect(store.isMiyoAvailableForCapability("chatSync")).toBe(false);
  });
});

describe("single-flight + TTL", () => {
  it("dedupes concurrent refreshes onto one fetch", async () => {
    let resolveFetch!: (value: MiyoHealthResponse) => void;
    mockFetchHealth.mockReturnValue(
      new Promise<MiyoHealthResponse>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const store = loadStore();
    const a = store.refreshMiyoStatus();
    const b = store.refreshMiyoStatus();
    resolveFetch(okHealth());
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

describe("stale downgrade", () => {
  it("downgrades available capabilities to stale past the stale horizon", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(0);
      mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
      const store = loadStore();
      await store.refreshMiyoStatus();
      expect(store.getMiyoStatusSnapshot().connector).toBe("available");

      // Advance past the 60s stale horizon.
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

describe("invalidateMiyoStatus + subscription", () => {
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
    let resolveFetch!: (value: MiyoHealthResponse) => void;
    mockFetchHealth.mockReturnValue(
      new Promise<MiyoHealthResponse>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const store = loadStore();
    const pending = store.refreshMiyoStatus();

    // Config changes while the fetch is still in flight.
    store.invalidateMiyoStatus();

    // The stale response lands afterwards — it must not resurrect status.
    resolveFetch(okHealth({ relay: { status: "connected" } }));
    await pending;

    expect(store.getMiyoStatusSnapshot().backend).toBe("unknown");
    expect(store.getMiyoStatusSnapshot().connector).toBe("unknown");
  });

  it("starts a fresh fetch after invalidation instead of reusing the stale in-flight request", async () => {
    // First refresh: an endpoint whose response is still pending.
    let resolveFirst!: (value: MiyoHealthResponse) => void;
    mockFetchHealth.mockReturnValueOnce(
      new Promise<MiyoHealthResponse>((resolve) => {
        resolveFirst = resolve;
      })
    );
    const store = loadStore();
    const first = store.refreshMiyoStatus();

    // Endpoint changes mid-flight: invalidate must clear the in-flight handle so
    // the next refresh probes the new endpoint rather than dedup'ing onto the
    // stale request (whose result the generation guard would discard, leaving the
    // new endpoint never probed).
    store.invalidateMiyoStatus();

    // Second refresh targets the new endpoint and returns connected.
    mockFetchHealth.mockResolvedValueOnce(okHealth({ relay: { status: "connected" } }));
    const second = await store.refreshMiyoStatus();

    // The stale first request settles late — it must not clobber the new result.
    resolveFirst(okHealth({ relay: { status: "disconnected" } }));
    await first;

    expect(mockFetchHealth).toHaveBeenCalledTimes(2);
    expect(second.backend).toBe("available");
    expect(store.getMiyoStatusSnapshot().backend).toBe("available");
    expect(store.getMiyoStatusSnapshot().connector).toBe("available");
  });

  it("invalidates the cache when the Miyo endpoint changes", async () => {
    mockFetchHealth.mockResolvedValue(okHealth({ relay: { status: "connected" } }));
    const store = loadStore();
    await store.refreshMiyoStatus();
    expect(store.getMiyoStatusSnapshot().backend).toBe("available");

    // Simulate a settings change to the server URL.
    const prev = {} as CopilotSettings;
    const next = { miyoServerUrl: "http://remote:1" } as CopilotSettings;
    mockGetMiyoCustomUrl.mockImplementation((s) => (s === next ? "http://remote:1" : ""));
    settingsSubscriber?.(prev, next);

    expect(store.getMiyoStatusSnapshot().backend).toBe("unknown");
  });
});
