const STORAGE_KEY = "obsidian-copilot:device-id:v1";

async function loadFreshGetDeviceId(): Promise<() => string> {
  jest.resetModules();
  const mod = await import("@/utils/deviceId");
  return mod.getDeviceId;
}

describe("getDeviceId", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns a stable, non-empty id across calls and persists it", async () => {
    const getDeviceId = await loadFreshGetDeviceId();
    const first = getDeviceId();
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(getDeviceId()).toBe(first);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(first);
  });

  it("reuses an id already present in localStorage", async () => {
    window.localStorage.setItem(STORAGE_KEY, "preset-device-id");
    const getDeviceId = await loadFreshGetDeviceId();
    expect(getDeviceId()).toBe("preset-device-id");
  });

  it("generates distinct ids for distinct devices (fresh module instances)", async () => {
    const getDeviceIdA = await loadFreshGetDeviceId();
    const a = getDeviceIdA();
    window.localStorage.clear();
    const getDeviceIdB = await loadFreshGetDeviceId();
    const b = getDeviceIdB();
    expect(a).not.toBe(b);
  });

  it("falls back to a stable sentinel when storage reads throw", async () => {
    jest.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("restricted");
    });
    const getDeviceId = await loadFreshGetDeviceId();
    expect(getDeviceId()).toBe("unknown");
    // Cached for the session: a second call stays stable without re-touching storage.
    expect(getDeviceId()).toBe("unknown");
  });

  it("falls back to a stable sentinel when storage writes throw", async () => {
    jest.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("restricted");
    });
    const getDeviceId = await loadFreshGetDeviceId();
    expect(getDeviceId()).toBe("unknown");
  });
});
