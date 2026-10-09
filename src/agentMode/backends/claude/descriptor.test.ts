import { signOutFromClaude } from "./claudeAuth";
jest.mock("./claudeAuth", () => ({ signOutFromClaude: jest.fn() }));

import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState } from "@/agentMode/session/types";
import { resetSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { MIYO_SEARCH_FOLDER_ENV, MIYO_SEARCH_SCOPE_ENV } from "@/builtinSkills/builtinSkills";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { FileSystemAdapter, type App } from "obsidian";
import { resolveClaudeBinary } from "./claudeBinaryResolver";
import { probeClaudeVersion } from "./claudeVersion";
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

jest.mock("./claudeVersion", () => ({
  ...jest.requireActual("./claudeVersion"),
  probeClaudeVersion: jest.fn(),
}));

const mockResolveClaudeBinary = resolveClaudeBinary as jest.MockedFunction<
  typeof resolveClaudeBinary
>;
const mockProbeClaudeVersion = probeClaudeVersion as jest.MockedFunction<typeof probeClaudeVersion>;

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

describe("descriptor", () => {
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
          dataNoticeAccepted: false,
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
    it("returns a stable absent state when no executable resolves", () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      const first = getClaudeInstallState(settingsWithClaudeRuntime({}));

      expect(first).toEqual({ kind: "absent" });
      expect(getClaudeInstallState(settingsWithClaudeRuntime({}))).toBe(first);
    });

    it("reports checking for an executable that has not been probed yet", () => {
      mockResolveClaudeBinary.mockReturnValue("/unprobed/claude");

      expect(
        getClaudeInstallState(settingsWithClaudeRuntime({ path: "/unprobed/claude" }))
      ).toEqual({ kind: "checking", source: "custom" });
    });

    it("returns the probed state regardless of the order of environment overrides", async () => {
      mockResolveClaudeBinary.mockReturnValue("/ordered/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({
          path: "/ordered/claude",
          envOverrides: { ZED: "last", ALPHA: "first" },
        })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({
            path: "/ordered/claude",
            envOverrides: { ALPHA: "first", ZED: "last" },
          })
        )
      ).toEqual({ kind: "ready", source: "custom" });
    });

    it("reports checking again when the environment overrides change for the same executable", async () => {
      mockResolveClaudeBinary.mockReturnValue("/env-keyed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "a" } })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "b" } })
        )
      ).toEqual({ kind: "checking", source: "custom" });
    });
  });

  describe("refreshClaudeInstallState()", () => {
    it("returns absent without probing when no executable resolves", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      await expect(refreshClaudeInstallState(settingsWithClaudeRuntime({}), true)).resolves.toEqual(
        { kind: "absent" }
      );
      expect(mockProbeClaudeVersion).not.toHaveBeenCalled();
    });

    it("probes the managed executable and publishes a ready state for a supported version", async () => {
      mockResolveClaudeBinary.mockReturnValue("/managed/bin/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({});

      await expect(refreshClaudeInstallState(settings, true)).resolves.toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(getClaudeInstallState(settings)).toEqual({ kind: "ready", source: "managed" });
    });

    it("reuses the cached state unless a forced refresh is requested", async () => {
      mockResolveClaudeBinary.mockReturnValue("/forced/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({ path: "/forced/claude" });

      await refreshClaudeInstallState(settings);
      await refreshClaudeInstallState(settings);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(1);

      await refreshClaudeInstallState(settings, true);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribeClaudeInstallState()", () => {
    it("notifies the listener of install state changes until it unsubscribes", async () => {
      mockResolveClaudeBinary.mockReturnValue("/subscribed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const listener = jest.fn();
      const unsubscribe = subscribeClaudeInstallState(listener);

      await refreshClaudeInstallState(settingsWithClaudeRuntime({ path: "/subscribed/claude" }));
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      unsubscribe();
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/subscribed/claude" }),
        true
      );
      expect(listener).not.toHaveBeenCalled();
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
