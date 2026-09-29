import {
  createCatalogSource,
  type CatalogSourceDeps,
} from "@/agentMode/session/host/catalogSource";
import type { BackendDescriptor } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

jest.mock("@/lib/lockedCopilotEntries", () => ({
  lockedCopilotEntries: () => [],
  shouldPreviewCopilotModels: () => false,
}));

function descriptor(id: string): BackendDescriptor {
  return {
    id,
    displayName: id.toUpperCase(),
    selfHostable: id !== "codex",
    routesCopilotModels: false,
    getEnabledModelEntries: () => [{ baseModelId: `${id}-m`, name: "M", credentialState: "ok" }],
    getInstallState: () => ({ kind: "ready", source: "custom" }),
  } as unknown as BackendDescriptor;
}

function build(overrides: Partial<CatalogSourceDeps["manager"]> = {}) {
  const settingsListeners: Array<() => void> = [];
  const installListeners: Array<() => void> = [];
  const cacheListeners: Array<() => void> = [];
  let settings = { agentMode: { activeBackend: "claude" } } as unknown as CopilotSettings;
  const manager: CatalogSourceDeps["manager"] = {
    getCachedModelCatalog: () => null,
    getEffortCatalog: () => null,
    getPreloadStatus: () => "pending",
    getDefaultSelection: (id) =>
      id === "claude" ? { baseModelId: "claude-m", effort: null } : null,
    getStartingBackendId: () => null,
    getLastError: () => null,
    subscribeModelCache: (listener) => {
      cacheListeners.push(listener);
      return () => cacheListeners.splice(cacheListeners.indexOf(listener), 1);
    },
    ...overrides,
  };
  const source = createCatalogSource({
    descriptors: () => [descriptor("claude"), descriptor("codex")],
    getSettings: () => settings,
    subscribeSettings: (listener) => {
      settingsListeners.push(listener);
      return () => settingsListeners.splice(settingsListeners.indexOf(listener), 1);
    },
    subscribeInstallState: (_descriptor, listener) => {
      installListeners.push(listener);
      return () => installListeners.splice(installListeners.indexOf(listener), 1);
    },
    needsSelfHostWarning: (d) => !d.selfHostable,
    manager,
  });
  return {
    source,
    settingsListeners,
    installListeners,
    cacheListeners,
    setSettings: (next: CopilotSettings) => {
      settings = next;
    },
  };
}

describe("catalogSource", () => {
  describe("createCatalogSource()", () => {
    it("lists a summary per descriptor with the manager's preload status, default selection and self-host warning", () => {
      const { source } = build();
      expect(source.listBackends()).toMatchObject([
        {
          id: "claude",
          preload: "pending",
          selfHostWarning: false,
          defaultSelection: { baseModelId: "claude-m", effort: null },
        },
        { id: "codex", preload: "pending", selfHostWarning: true, defaultSelection: null },
      ]);
    });

    it("reports the configured default backend and whether a session is starting", () => {
      const { source } = build({ getStartingBackendId: () => "codex" });
      expect(source.getFlags()).toEqual({
        defaultBackendId: "claude",
        startingBackendId: "codex",
        startFailed: false,
      });
    });

    it("reports a failed start as a boolean and never as the manager's error text", () => {
      const { source } = build({
        getLastError: () => "spawn /Users/me/.claude/bin ENOENT --api-key sk-secret",
      });
      const flags = source.getFlags();
      expect(flags.startFailed).toBe(true);
      expect(JSON.stringify(flags)).not.toContain("sk-secret");
    });

    it("reports no default backend when settings name none", () => {
      const built = build();
      built.setSettings({ agentMode: {} } as unknown as CopilotSettings);
      expect(built.source.getFlags().defaultBackendId).toBeNull();
    });

    it("calls the listener for settings, model cache and each backend's install state until unsubscribed", () => {
      const built = build();
      const listener = jest.fn();
      const stop = built.source.subscribe(listener);
      built.settingsListeners.forEach((fn) => fn());
      built.cacheListeners.forEach((fn) => fn());
      built.installListeners.forEach((fn) => fn());
      expect(built.installListeners).toHaveLength(2);
      expect(listener).toHaveBeenCalledTimes(4);
      stop();
      expect(built.settingsListeners).toHaveLength(0);
      expect(built.cacheListeners).toHaveLength(0);
      expect(built.installListeners).toHaveLength(0);
    });
  });
});
