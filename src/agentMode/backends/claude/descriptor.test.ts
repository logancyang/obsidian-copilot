import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState, InstallState } from "@/agentMode/session/types";
import { resetSettings, type CopilotSettings } from "@/settings/model";
import { resolveClaudeBinary } from "./claudeBinaryResolver";
import { claudeCompatibilityStore } from "./claudeCompatibilityStore";
import {
  ClaudeBackendDescriptor,
  getClaudeInstallState,
  refreshClaudeInstallState,
  resolveClaudeAutoModePermission,
  subscribeClaudeInstallState,
  updateClaudeFields,
} from "./descriptor";

jest.mock("./claudeBinaryResolver", () => ({
  claudeBinarySearchDirs: jest.fn(() => []),
  resolveClaudeBinary: jest.fn(),
}));

jest.mock("./claudeCompatibilityStore", () => ({
  claudeCompatibilityStore: {
    get: jest.fn(),
    refresh: jest.fn(),
    subscribe: jest.fn(),
  },
}));

const mockResolveClaudeBinary = resolveClaudeBinary as jest.MockedFunction<
  typeof resolveClaudeBinary
>;
const mockGetCompatibility = claudeCompatibilityStore.get as jest.MockedFunction<
  typeof claudeCompatibilityStore.get
>;
const mockRefreshCompatibility = claudeCompatibilityStore.refresh as jest.MockedFunction<
  typeof claudeCompatibilityStore.refresh
>;
const mockSubscribeCompatibility = claudeCompatibilityStore.subscribe as jest.MockedFunction<
  typeof claudeCompatibilityStore.subscribe
>;

function settingsWithClaudeRuntime(options: {
  path?: string;
  envOverrides?: Record<string, string>;
}): CopilotSettings {
  return {
    agentMode: {
      claudeCli: options.path ? { path: options.path } : undefined,
      backends: {
        claude: {
          envOverrides: options.envOverrides,
        },
      },
    },
  } as unknown as CopilotSettings;
}

describe("claude descriptor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("getClaudeInstallState()", () => {
    it("returns absent without consulting compatibility state when no executable resolves", () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      const first = getClaudeInstallState(settingsWithClaudeRuntime({}));

      expect(first).toEqual({ kind: "absent" });
      expect(getClaudeInstallState(settingsWithClaudeRuntime({}))).toBe(first);
      expect(mockGetCompatibility).not.toHaveBeenCalled();
    });

    it("reads compatibility state using the custom executable and sorted environment identity", () => {
      const readyState: InstallState = { kind: "ready", source: "custom" };
      mockResolveClaudeBinary.mockReturnValue("/custom/bin/claude");
      mockGetCompatibility.mockReturnValue(readyState);

      const result = getClaudeInstallState(
        settingsWithClaudeRuntime({
          path: "/custom/bin/claude",
          envOverrides: { ZED: "last", ALPHA: "first" },
        })
      );

      expect(result).toBe(readyState);
      expect(mockGetCompatibility).toHaveBeenCalledWith({
        cacheKey: 'custom\u0000/custom/bin/claude\u0000[["ALPHA","first"],["ZED","last"]]',
        path: "/custom/bin/claude",
        source: "custom",
        env: expect.objectContaining({ ALPHA: "first", ZED: "last" }),
      });
    });
  });

  describe("refreshClaudeInstallState()", () => {
    it("does not refresh compatibility state when no executable resolves", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      await expect(refreshClaudeInstallState(settingsWithClaudeRuntime({}), true)).resolves.toEqual(
        {
          kind: "absent",
        }
      );
      expect(mockRefreshCompatibility).not.toHaveBeenCalled();
    });

    it("forces a refresh for the managed executable and returns its new state", async () => {
      const readyState: InstallState = { kind: "ready", source: "managed" };
      mockResolveClaudeBinary.mockReturnValue("/managed/bin/claude");
      mockRefreshCompatibility.mockResolvedValue(readyState);

      const result = await refreshClaudeInstallState(settingsWithClaudeRuntime({}), true);

      expect(result).toBe(readyState);
      expect(mockRefreshCompatibility).toHaveBeenCalledWith(
        {
          cacheKey: "managed\u0000/managed/bin/claude\u0000[]",
          path: "/managed/bin/claude",
          source: "managed",
          env: process.env,
        },
        { force: true }
      );
    });
  });

  describe("subscribeClaudeInstallState()", () => {
    it("subscribes to compatibility changes and returns the matching unsubscribe function", () => {
      const listener = jest.fn();
      const unsubscribe = jest.fn();
      mockSubscribeCompatibility.mockReturnValue(unsubscribe);

      expect(subscribeClaudeInstallState(listener)).toBe(unsubscribe);
      expect(mockSubscribeCompatibility).toHaveBeenCalledWith(listener);
    });
  });

  describe("ClaudeBackendDescriptor.applySelection()", () => {
    function makeSession(currentBaseModelId: string): {
      session: AgentSession;
      applyModelWireId: jest.Mock;
    } {
      const state: BackendState = {
        model: {
          current: { baseModelId: currentBaseModelId, effort: null },
          availableModels: [],
          apply: { kind: "setModel" },
        },
        mode: null,
      };
      const applyModelWireId = jest.fn(async () => undefined);
      return {
        session: {
          getState: () => state,
          applyModelWireId,
        } as unknown as AgentSession,
        applyModelWireId,
      };
    }

    it("uses backend-confirmed startup state when the session is optimistically seeded", async () => {
      const { session, applyModelWireId } = makeSession("sonnet");

      await ClaudeBackendDescriptor.applySelection(
        session,
        { baseModelId: "sonnet", effort: null },
        { backendReportedCurrent: { baseModelId: "default", effort: null } }
      );

      expect(applyModelWireId).toHaveBeenCalledWith("sonnet");
    });

    it("skips the model write for an ordinary same-model selection", async () => {
      const { session, applyModelWireId } = makeSession("sonnet");

      await ClaudeBackendDescriptor.applySelection(session, {
        baseModelId: "sonnet",
        effort: null,
      });

      expect(applyModelWireId).not.toHaveBeenCalled();
    });
  });

  describe("resolveClaudeAutoModePermission()", () => {
    it("falls back to Claude's classifier mode when nothing is persisted", () => {
      expect(resolveClaudeAutoModePermission({ agentMode: {} } as CopilotSettings)).toBe("auto");
    });

    it("returns the persisted permission mode", () => {
      const settings = {
        agentMode: { backends: { claude: { autoModePermission: "acceptEdits" } } },
      } as unknown as CopilotSettings;

      expect(resolveClaudeAutoModePermission(settings)).toBe("acceptEdits");
    });
  });

  describe("ClaudeBackendDescriptor.getModeMapping()", () => {
    afterEach(() => {
      resetSettings();
    });

    it("points the auto pill at Claude's classifier mode by default", () => {
      resetSettings();

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)).toEqual({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "auto" },
      });
    });

    it("points the auto pill at the user's configured permission mode", () => {
      updateClaudeFields({ autoModePermission: "bypassPermissions" });

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)?.canonical.auto).toBe(
        "bypassPermissions"
      );
    });
  });
});
