import { signOutFromClaude } from "./claudeAuth";
jest.mock("./claudeAuth", () => ({ signOutFromClaude: jest.fn() }));

import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState, InstallState } from "@/agentMode/session/types";
import { resetSettings, setSettings, type CopilotSettings } from "@/settings/model";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
} from "@/agentMode/skills/builtin/builtinSkills";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { FileSystemAdapter, type App } from "obsidian";
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

  describe("ClaudeBackendDescriptor.auth.getProbeKey()", () => {
    afterEach(() => jest.restoreAllMocks());
    it.each(["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates authentication when effective %s changes without exposing secrets",
      (variable) => {
        mockResolveClaudeBinary.mockReturnValue("/cli");
        const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
        const changed = ClaudeBackendDescriptor.auth.getProbeKey!(
          settingsWithClaudeRuntime({ envOverrides: { [variable]: "private-fixture-value" } })
        );
        expect(changed).not.toBe(original);
        expect(changed).toMatch(/^[a-f0-9]{64}$/);
        expect(changed).not.toContain("private-fixture-value");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates a newly resolved CLI", () => {
      mockResolveClaudeBinary.mockReturnValueOnce("/first/cli").mockReturnValueOnce("/second/cli");
      const settings = settingsWithClaudeRuntime({});
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settings)).not.toBe(
        ClaudeBackendDescriptor.auth.getProbeKey!(settings)
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves identity when override order or provenance changes without changing the effective profile", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", {
        CLAUDE_CONFIG_DIR: "/profile",
        ANTHROPIC_API_KEY: "private-fixture-key",
      });
      const inherited = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      const overridden = ClaudeBackendDescriptor.auth.getProbeKey!(
        settingsWithClaudeRuntime({
          envOverrides: { ANTHROPIC_API_KEY: "private-fixture-key", CLAUDE_CONFIG_DIR: "/profile" },
        })
      );
      expect(inherited).toBe(overridden);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates an inherited credential change", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "first-fixture" });
      const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "second-fixture" });
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}))).not.toBe(
        original
      );
    });
  });

  describe("ClaudeBackendDescriptor.auth.signOut()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 signs out using the session CLI and profile and preserves the resulting account label", async () => {
      mockResolveClaudeBinary.mockReturnValue("/custom/claude");
      jest
        .mocked(signOutFromClaude)
        .mockResolvedValue({ loggedIn: true, label: "zero@example.com (max)" });
      const options = { signal: new AbortController().signal };
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(
          settingsWithClaudeRuntime({ envOverrides: { CLAUDE_CONFIG_DIR: "/custom profile" } }),
          options
        )
      ).resolves.toEqual({ signedIn: true, label: "zero@example.com (max)" });
      expect(signOutFromClaude).toHaveBeenCalledWith(
        "/custom/claude",
        expect.objectContaining({ CLAUDE_CONFIG_DIR: "/custom profile" }),
        options
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 does not claim credentials were removed when the CLI is missing", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(settingsWithClaudeRuntime({}))
      ).rejects.toThrow("Install Claude Code before signing out");
      expect(signOutFromClaude).not.toHaveBeenCalled();
    });
  });
  describe("ClaudeBackendDescriptor.createBackendProcess()", () => {
    afterEach(() => {
      resetSettings();
      __resetVaultBaseCache();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 gives global and Project sessions the same protected active-vault Miyo identity", async () => {
      resetSettings();
      __resetVaultBaseCache();
      mockResolveClaudeBinary.mockReturnValue("/usr/local/bin/claude");
      setSettings({
        miyoSearchAll: false,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          debugFullFrames: false,
          notificationSound: false,
          notificationSoundId: "piano",
          welcomeDismissed: false,
          skills: { folder: "copilot/skills" },
          backends: {
            claude: {
              envOverrides: {
                [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
                [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
              },
            },
          },
        },
      });
      const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
      adapter.getBasePath = () => "/active-vault";
      const app = { vault: { adapter, getName: () => "active-vault" } } as unknown as App;

      const process = ClaudeBackendDescriptor.createBackendProcess({
        plugin: {} as never,
        app,
        clientVersion: "4.0.0",
        descriptor: ClaudeBackendDescriptor,
      }) as unknown as {
        opts: {
          getEnvOverrides?: () => Record<string, string> | undefined;
          getManagedEnv?: () => Promise<Readonly<Record<string, string>>>;
        };
      };

      expect(process.opts.getEnvOverrides?.()).toEqual({});
      await expect(process.opts.getManagedEnv?.()).resolves.toEqual(
        expect.objectContaining({
          [MIYO_SEARCH_SCOPE_ENV]: "current",
          [MIYO_SEARCH_FOLDER_ENV]: "active-vault",
        })
      );
    });
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

    it.each([null, "removed", "high"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies a concrete effort for preference %p",
      async (effort) => {
        const spy = jest.spyOn(ClaudeBackendDescriptor.wire, "effortConfigFor").mockReturnValue({
          id: "effort",
          type: "select",
          name: "Effort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        });
        const setConfigOption = jest.fn();
        const session = {
          getState: () => ({
            model: {
              current: { baseModelId: "sonnet", effort: "high" },
              availableModels: [
                {
                  baseModelId: "sonnet",
                  effortOptions: [
                    { value: "high", label: "High" },
                    { value: "low", label: "Low" },
                  ],
                },
              ],
            },
          }),
          setConfigOption,
        } as unknown as AgentSession;
        try {
          await ClaudeBackendDescriptor.applySelection(session, { baseModelId: "sonnet", effort });
          expect(setConfigOption).toHaveBeenCalledWith(
            "effort",
            effort === "high" ? "high" : "low"
          );
        } finally {
          spy.mockRestore();
        }
      }
    );

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
