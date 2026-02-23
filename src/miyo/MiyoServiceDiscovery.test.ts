import { MiyoServiceDiscovery, type MiyoServiceConfig } from "@/miyo/MiyoServiceDiscovery";
import { Platform } from "obsidian";

jest.mock("obsidian", () => ({
  Platform: {
    isDesktopApp: true,
  },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    debug: false,
  })),
}));

interface MockNodeModules {
  pathJoin: jest.Mock<string, [string, ...string[]]>;
  readFile: jest.Mock<Promise<string>, [string, string]>;
}

type NodeRequireShape = (id: string) => unknown;

/**
 * Reset the singleton state between tests.
 */
function resetMiyoServiceDiscoverySingleton(): void {
  (MiyoServiceDiscovery as unknown as { instance?: MiyoServiceDiscovery }).instance = undefined;
}

/**
 * Build a mocked Node-style require function for discovery tests.
 *
 * @param platform - Simulated OS platform.
 * @param homeDir - Simulated user home directory.
 * @param config - Service discovery payload to return from fs.readFile.
 * @returns Mock require function plus module spies.
 */
function createMockNodeRequire(
  platform: string,
  homeDir: string,
  config: MiyoServiceConfig,
  options?: {
    readFileError?: Error;
    readFileByPath?: Record<string, string | Error>;
    env?: Record<string, string | undefined>;
  }
): {
  nodeRequire: NodeRequireShape;
  modules: MockNodeModules;
} {
  const pathJoin = jest.fn((first: string, ...rest: string[]) => [first, ...rest].join("/"));
  const readFile = jest.fn(async (_path: string, _encoding: string) => {
    const pathOverride = options?.readFileByPath?.[_path];
    if (pathOverride instanceof Error) {
      throw pathOverride;
    }
    if (typeof pathOverride === "string") {
      return pathOverride;
    }
    if (options?.readFileError) {
      throw options.readFileError;
    }
    return JSON.stringify(config);
  });
  const nodeRequire: NodeRequireShape = (id: string): unknown => {
    if (id === "os") {
      return {
        homedir: () => homeDir,
        platform: () => platform,
      };
    }
    if (id === "path") {
      return {
        join: pathJoin,
      };
    }
    if (id === "fs") {
      return {
        promises: {
          readFile,
        },
      };
    }
    if (id === "process") {
      return {
        env: options?.env || {},
      };
    }
    throw new Error(`Unexpected module request: ${id}`);
  };

  return {
    nodeRequire,
    modules: {
      pathJoin,
      readFile,
    },
  };
}

describe("MiyoServiceDiscovery", () => {
  const originalRequire = (globalThis as { require?: NodeRequireShape }).require;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMiyoServiceDiscoverySingleton();
    (Platform as { isDesktopApp: boolean }).isDesktopApp = true;
  });

  afterEach(() => {
    (globalThis as { require?: NodeRequireShape }).require = originalRequire;
  });

  it("resolves macOS service.json path", async () => {
    const { nodeRequire, modules } = createMockNodeRequire("darwin", "/Users/test", {
      host: "127.0.0.1",
      port: 8742,
      pid: 999,
    });
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBe("http://127.0.0.1:8742");
    expect(modules.readFile).toHaveBeenCalledWith(
      "/Users/test/Library/Application Support/Miyo/service.json",
      "utf8"
    );
  });

  it("resolves Windows service.json path", async () => {
    const { nodeRequire, modules } = createMockNodeRequire("win32", "C:/Users/test", {
      host: "127.0.0.1",
      port: 8742,
      pid: 999,
    });
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBe("http://127.0.0.1:8742");
    expect(modules.readFile).toHaveBeenCalledWith(
      "C:/Users/test/AppData/Local/Miyo/service.json",
      "utf8"
    );
  });

  it("resolves Linux service.json path", async () => {
    const { nodeRequire, modules } = createMockNodeRequire("linux", "/home/test", {
      host: "127.0.0.1",
      port: 8742,
      pid: 999,
    });
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBe("http://127.0.0.1:8742");
    expect(modules.readFile).toHaveBeenCalledWith("/home/test/.config/Miyo/service.json", "utf8");
  });

  it("returns null for unsupported platforms", async () => {
    const { nodeRequire, modules } = createMockNodeRequire("freebsd", "/home/test", {
      host: "127.0.0.1",
      port: 8742,
      pid: 999,
    });
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBeNull();
    expect(modules.readFile).not.toHaveBeenCalled();
  });

  it("falls back to localhost:8742 when service.json is missing", async () => {
    const missingFileError = Object.assign(new Error("not found"), { code: "ENOENT" });
    const { nodeRequire, modules } = createMockNodeRequire(
      "linux",
      "/home/test",
      {
        host: "127.0.0.1",
        port: 8742,
        pid: 999,
      },
      { readFileError: missingFileError }
    );
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBe("http://127.0.0.1:8742");
    expect(modules.readFile).toHaveBeenCalledWith("/home/test/.config/Miyo/service.json", "utf8");
  });

  it("checks Roaming path on Windows when Local path is missing", async () => {
    const missingFileError = Object.assign(new Error("not found"), { code: "ENOENT" });
    const { nodeRequire, modules } = createMockNodeRequire(
      "win32",
      "C:/Users/test",
      {
        host: "127.0.0.1",
        port: 9999,
        pid: 999,
      },
      {
        readFileByPath: {
          "C:/Users/test/AppData/Local/Miyo/service.json": missingFileError,
          "C:/Users/test/AppData/Roaming/Miyo/service.json": JSON.stringify({
            host: "127.0.0.1",
            port: 8742,
            pid: 999,
          } as MiyoServiceConfig),
        },
      }
    );
    (globalThis as { require?: NodeRequireShape }).require = nodeRequire;

    const baseUrl = await MiyoServiceDiscovery.getInstance().resolveBaseUrl({ forceRefresh: true });

    expect(baseUrl).toBe("http://127.0.0.1:8742");
    expect(modules.readFile).toHaveBeenNthCalledWith(
      1,
      "C:/Users/test/AppData/Local/Miyo/service.json",
      "utf8"
    );
    expect(modules.readFile).toHaveBeenNthCalledWith(
      2,
      "C:/Users/test/AppData/Roaming/Miyo/service.json",
      "utf8"
    );
  });
});
