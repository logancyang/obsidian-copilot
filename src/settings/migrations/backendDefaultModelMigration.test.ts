import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";

import { planBackendDefaultModels } from "./backendDefaultModelMigration";

/**
 * A vault as it reaches v15: provider rows, configured models, per-backend
 * enabled lists, and whatever legacy defaults the old readers left behind.
 */
function vault(overrides: Partial<CopilotSettings> & Record<string, unknown>): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    providers: {
      "plus-1": {
        providerId: "plus-1",
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        origin: { kind: "copilot-plus" },
        addedAt: 0,
      },
      "anthropic-1": {
        providerId: "anthropic-1",
        providerType: "anthropic",
        displayName: "Anthropic",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        addedAt: 0,
      },
      "claude-agent": {
        providerId: "claude-agent",
        providerType: "anthropic",
        displayName: "Claude Code",
        origin: { kind: "agent", agentType: "claude" },
        addedAt: 0,
      },
      "codex-agent": {
        providerId: "codex-agent",
        providerType: "openai",
        displayName: "Codex",
        origin: { kind: "agent", agentType: "codex" },
        addedAt: 0,
      },
    },
    configuredModels: [
      {
        configuredModelId: "cm-flash",
        providerId: "plus-1",
        info: { id: "gemini-2.5-flash", displayName: "Copilot Plus Flash" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-sonnet-byok",
        providerId: "anthropic-1",
        info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-sonnet-claude",
        providerId: "claude-agent",
        info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-gpt",
        providerId: "codex-agent",
        info: { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
        configuredAt: 0,
      },
    ],
    ...overrides,
  } as unknown as CopilotSettings;
}

/** A vault whose saved agent default is `saved` on `backend`. */
function withAgentDefault(
  backend: "opencode" | "claude" | "codex",
  saved: unknown,
  backends: Record<string, unknown>
): CopilotSettings {
  return vault({
    backends,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { [backend]: { defaultModel: saved } } },
  });
}

describe("backendDefaultModelMigration", () => {
  describe("planBackendDefaultModels()", () => {
    it("maps a legacy `wireModelId|provider` chat key onto the configured model it named", () => {
      const plan = planBackendDefaultModels(
        vault({
          defaultModelKey: "gemini-2.5-flash|copilot-plus",
          backends: { chat: { enabledModels: ["cm-sonnet-byok", "cm-flash"] } },
        })
      );

      expect(plan.backends?.chat).toEqual({
        enabledModels: ["cm-sonnet-byok", "cm-flash"],
        default: { configuredModelId: "cm-flash" },
      });
      expect(plan.unresolved).toEqual([]);
    });

    it("keeps a chat key that is already a configuredModelId", () => {
      const plan = planBackendDefaultModels(
        vault({
          defaultModelKey: "cm-sonnet-byok",
          backends: { chat: { enabledModels: ["cm-flash", "cm-sonnet-byok"] } },
        })
      );

      expect(plan.backends?.chat?.default).toEqual({ configuredModelId: "cm-sonnet-byok" });
    });

    it.each([
      ["an empty chat key", ""],
      ["no chat key at all", undefined],
    ])(
      "records nothing for %s, leaving the reader to keep picking the first enabled model",
      (_case, defaultModelKey) => {
        const plan = planBackendDefaultModels(
          vault({
            defaultModelKey,
            backends: { chat: { enabledModels: ["cm-flash", "cm-sonnet-byok"] } },
          })
        );

        expect(plan.backends).toBeNull();
        expect(plan.unresolved).toEqual([]);
      }
    );

    it("leaves the chat default unset when the saved key names no enabled model, rather than pinning the first one (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", () => {
      // A Copilot Plus key resolves to nothing until the licensed provider rows
      // are back. The old pointer self-corrected once they synced; a stand-in
      // written into the row would outlive the outage.
      const plan = planBackendDefaultModels(
        vault({
          defaultModelKey: "gemini-2.5-flash|copilot-plus",
          backends: { chat: { enabledModels: ["cm-sonnet-byok"] } },
        })
      );

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([
        { backend: "chat", saved: "gemini-2.5-flash|copilot-plus", reason: "no-match" },
      ]);
    });

    it("leaves the chat default unset when nothing is enabled to fall back to", () => {
      const plan = planBackendDefaultModels(
        vault({ defaultModelKey: "cm-flash", backends: { chat: { enabledModels: [] } } })
      );

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([{ backend: "chat", saved: "cm-flash", reason: "no-match" }]);
    });

    it("maps an opencode default through the provider prefix its wire id carries", () => {
      const plan = planBackendDefaultModels(
        withAgentDefault(
          "opencode",
          { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
          { opencode: { enabledModels: ["cm-flash", "cm-sonnet-byok"] } }
        )
      );

      expect(plan.backends?.opencode).toEqual({
        enabledModels: ["cm-flash", "cm-sonnet-byok"],
        default: { configuredModelId: "cm-sonnet-byok", effort: null },
      });
    });

    it("maps a claude default, whose wire id is the model's own id", () => {
      const plan = planBackendDefaultModels(
        withAgentDefault(
          "claude",
          { baseModelId: "claude-sonnet-4-5", effort: "high" },
          { claude: { enabledModels: ["cm-sonnet-claude"] } }
        )
      );

      expect(plan.backends?.claude?.default).toEqual({
        configuredModelId: "cm-sonnet-claude",
        effort: "high",
      });
    });

    it("maps a codex default onto the enabled row whose bracketed id shares its base", () => {
      const settings = withAgentDefault(
        "codex",
        { baseModelId: "gpt-5.6-sol", effort: "xhigh" },
        { codex: { enabledModels: ["cm-gpt"] } }
      );
      // codex-acp addresses a model as `<base>[<effort>]`, so a row whose stored
      // id still carries the suffix has to be matched on its base.
      settings.configuredModels[3].info.id = "gpt-5.6-sol[high]";

      const plan = planBackendDefaultModels(settings);

      expect(plan.backends?.codex?.default).toEqual({
        configuredModelId: "cm-gpt",
        effort: "xhigh",
      });
    });

    it.each([
      ["a chosen level", "high"],
      ["the agent's own level", null],
    ])("carries %s across verbatim", (_case, effort) => {
      const plan = planBackendDefaultModels(
        withAgentDefault(
          "claude",
          { baseModelId: "claude-sonnet-4-5", effort },
          { claude: { enabledModels: ["cm-sonnet-claude"] } }
        )
      );

      expect(plan.backends?.claude?.default?.effort).toBe(effort);
    });

    it("leaves the default unset when the saved model is no longer enabled", () => {
      const plan = planBackendDefaultModels(
        withAgentDefault(
          "opencode",
          { baseModelId: "copilot-plus/withdrawn", effort: "high" },
          { opencode: { enabledModels: ["cm-flash"] } }
        )
      );

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([
        { backend: "opencode", saved: "copilot-plus/withdrawn", reason: "no-match" },
      ]);
    });

    it("refuses to guess when two enabled models compute to the same wire id", () => {
      const settings = withAgentDefault(
        "opencode",
        { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
        { opencode: { enabledModels: ["cm-sonnet-byok", "cm-sonnet-twin"] } }
      );
      // A second BYOK row on the same catalog provider, serving the same model.
      settings.providers["anthropic-2"] = {
        providerId: "anthropic-2",
        providerType: "anthropic",
        displayName: "Anthropic (work)",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        addedAt: 0,
      };
      settings.configuredModels.push({
        configuredModelId: "cm-sonnet-twin",
        providerId: "anthropic-2",
        info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
        configuredAt: 0,
      });

      const plan = planBackendDefaultModels(settings);

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([
        { backend: "opencode", saved: "anthropic/claude-sonnet-4-5", reason: "ambiguous" },
      ]);
    });

    it("skips a backend that never had a saved default", () => {
      const plan = planBackendDefaultModels(
        vault({ backends: { opencode: { enabledModels: ["cm-flash"] } } })
      );

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([]);
    });

    it("resolves every backend in one plan, preserving each enabled list", () => {
      const plan = planBackendDefaultModels(
        vault({
          defaultModelKey: "cm-flash",
          backends: {
            chat: { enabledModels: ["cm-flash"] },
            opencode: { enabledModels: ["cm-sonnet-byok"] },
            claude: { enabledModels: ["cm-sonnet-claude"] },
            codex: { enabledModels: ["cm-gpt"] },
          },
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            backends: {
              opencode: {
                defaultModel: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
              },
              claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
              codex: { defaultModel: { baseModelId: "gpt-5.6-sol", effort: "low" } },
            },
          },
        })
      );

      expect(plan.backends).toEqual({
        chat: { enabledModels: ["cm-flash"], default: { configuredModelId: "cm-flash" } },
        opencode: {
          enabledModels: ["cm-sonnet-byok"],
          default: { configuredModelId: "cm-sonnet-byok", effort: null },
        },
        claude: {
          enabledModels: ["cm-sonnet-claude"],
          default: { configuredModelId: "cm-sonnet-claude", effort: null },
        },
        codex: {
          enabledModels: ["cm-gpt"],
          default: { configuredModelId: "cm-gpt", effort: "low" },
        },
      });
    });

    it("still maps the other backends when the chat enabled list is a string rather than an array (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", () => {
      // `sanitizeSettings` checks that `backends` is an object but never
      // validates a row, so a hand-edited or synced `"enabledModels": "cm-flash"`
      // arrives intact and throws the moment `chatEntries` calls `.map` on it.
      const settings = vault({
        defaultModelKey: "cm-flash",
        backends: {
          chat: { enabledModels: ["cm-flash"] },
          claude: { enabledModels: ["cm-sonnet-claude"] },
        },
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
          },
        },
      });
      (settings.backends as Record<string, unknown>).chat = { enabledModels: "cm-flash" };

      const plan = planBackendDefaultModels(settings);

      expect(plan.backends?.claude?.default).toEqual({
        configuredModelId: "cm-sonnet-claude",
        effort: null,
      });
      expect(plan.backends?.chat?.default).toBeUndefined();
      expect(plan.unresolved).toEqual([{ backend: "chat", saved: "cm-flash", reason: "no-match" }]);
    });

    it("leaves an agent default unset when its enabled list is not iterable (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", () => {
      // The agent half of the same unvalidated row: `matchAgentDefault` walks
      // the list with `for…of`, which throws outright on an object.
      const settings = withAgentDefault(
        "claude",
        { baseModelId: "claude-sonnet-4-5", effort: null },
        { claude: { enabledModels: ["cm-sonnet-claude"] } }
      );
      (settings.backends as Record<string, unknown>).claude = {
        enabledModels: { 0: "cm-sonnet-claude" },
      };

      const plan = planBackendDefaultModels(settings);

      expect(plan.backends).toBeNull();
      expect(plan.unresolved).toEqual([
        { backend: "claude", saved: "<unreadable>", reason: "no-match" },
      ]);
    });
  });
});
