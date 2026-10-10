import {
  buildModelEnableGroups,
  opencodeOnlySubGroupLabel,
  partitionCandidates,
  partitionChatCandidates,
  rowMatches,
  toRow,
  type Candidate,
} from "./configuredModelGrouping";
import type { ConfiguredModel, PersistedCopilotPlusCatalog, Provider } from "@/modelManagement";
import { ModelCapability } from "@/constants";

const PLUS_CATALOG: PersistedCopilotPlusCatalog = {
  models: [
    { id: "copilot-plus-flash", displayName: "Copilot Plus Flash", description: "The default." },
    { id: "glm-5.2", displayName: "GLM-5.2", description: "Frontier open weights." },
  ],
  defaultEnabledIds: ["copilot-plus-flash"],
};

function byokProvider(id: string, displayName: string): Provider {
  return {
    providerId: id,
    providerType: "anthropic",
    displayName,
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
  };
}

function agentProvider(
  id: string,
  agentType: "opencode" | "claude" | "codex",
  displayName = id
): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName,
    origin: { kind: "agent", agentType },
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string, infoId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: infoId, displayName: infoId },
    configuredAt: 0,
  };
}

describe("configuredModelGrouping", () => {
  describe("partitionCandidates()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const ocAgent = agentProvider("oc-agent", "opencode", "opencode");
    const codexAgent = agentProvider("codex-agent", "codex", "Codex");
    const providers = {
      [byok.providerId]: byok,
      [ocAgent.providerId]: ocAgent,
      [codexAgent.providerId]: codexAgent,
    };
    const models = [
      model("m-byok", "byok-1", "claude-sonnet-4-5"),
      model("m-oc", "oc-agent", "opencode/big-pickle"),
      model("m-codex", "codex-agent", "gpt-5"),
    ];

    it("opencode: BYOK rows + opencode agent-origin rows; excludes other agents", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-byok",
      ]);
      expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-oc",
      ]);
    });

    it("codex: only this agent's agent-origin rows, no BYOK", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(),
        "codex",
        false
      );
      expect(byokPlusCandidates).toHaveLength(0);
      expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-codex",
      ]);
    });

    it("reflects enabled state from the enabled-id set", () => {
      const { agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(["m-codex"]),
        "codex",
        false
      );
      expect(agentOriginCandidates[0].enabled).toBe(true);
    });

    it("opencode: drops BYOK/Plus providers the routability predicate rejects (dead-toggle guard)", () => {
      const unroutable: Provider = {
        providerId: "byok-google",
        providerType: "google",
        displayName: "Google",
        origin: { kind: "byok" },
        addedAt: 0,
      };
      const withUnroutable = {
        ...providers,
        [unroutable.providerId]: unroutable,
      };
      const allModels = [...models, model("m-google", "byok-google", "gemini-3-flash")];
      const isRoutable = (p: Provider): boolean =>
        p.origin.kind === "byok" ? Boolean(p.origin.catalogProviderId) : true;
      const { byokPlusCandidates } = partitionCandidates(
        allModels,
        withUnroutable,
        new Set(),
        "opencode",
        true,
        isRoutable
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-byok",
      ]);
    });

    it("opencode: keeps every BYOK/Plus provider when no routability predicate is given", () => {
      const unroutable: Provider = {
        providerId: "byok-google",
        providerType: "google",
        displayName: "Google",
        origin: { kind: "byok" },
        addedAt: 0,
      };
      const allModels = [...models, model("m-google", "byok-google", "gemini-3-flash")];
      const { byokPlusCandidates } = partitionCandidates(
        allModels,
        { ...providers, [unroutable.providerId]: unroutable },
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId).sort()).toEqual([
        "m-byok",
        "m-google",
      ]);
    });

    it("skips models whose provider row is missing", () => {
      const orphan = [model("orphan", "missing-provider", "x")];
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        orphan,
        providers,
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates).toHaveLength(0);
      expect(agentOriginCandidates).toHaveLength(0);
    });
  });

  describe("partitionChatCandidates()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const agent = agentProvider("codex-agent", "codex", "Codex");
    const providers = { [byok.providerId]: byok, [agent.providerId]: agent };

    it("lists non-agent chat models with their enabled state and no agent-origin rows", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionChatCandidates(
        [
          model("m-on", "byok-1", "claude-sonnet-4-5"),
          model("m-off", "byok-1", "claude-haiku-4-5"),
        ],
        providers,
        new Set(["m-on"])
      );
      expect(
        byokPlusCandidates.map((c) => [c.configuredModel.configuredModelId, c.enabled])
      ).toEqual([
        ["m-on", true],
        ["m-off", false],
      ]);
      expect(agentOriginCandidates).toEqual([]);
    });

    it("omits embedding models, agent-origin models, and models whose provider is missing", () => {
      const embedding: ConfiguredModel = {
        ...model("m-embed", "byok-1", "text-embedding-3-small"),
        info: { id: "text-embedding-3-small", displayName: "Embed", isEmbedding: true },
      };
      const { byokPlusCandidates } = partitionChatCandidates(
        [
          embedding,
          model("m-agent", "codex-agent", "gpt-5"),
          model("m-orphan", "missing-provider", "x"),
          model("m-chat", "byok-1", "claude-sonnet-4-5"),
        ],
        providers,
        new Set()
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-chat",
      ]);
    });
  });

  describe("opencodeOnlySubGroupLabel()", () => {
    const provider = agentProvider("oc-agent", "opencode", "opencode");

    it("derives the label from the wire-id prefix (first /-segment)", () => {
      expect(
        opencodeOnlySubGroupLabel(model("a", "oc-agent", "opencode/big-pickle"), provider)
      ).toBe("opencode");
      expect(
        opencodeOnlySubGroupLabel(model("b", "oc-agent", "openrouter/anthropic/claude"), provider)
      ).toBe("openrouter");
    });

    it("falls back to the provider display name when the id has no prefix", () => {
      expect(opencodeOnlySubGroupLabel(model("c", "oc-agent", "bare-model"), provider)).toBe(
        "opencode"
      );
    });
  });

  describe("toRow()", () => {
    it("never surfaces the wire id as the description (it duplicates the label)", () => {
      const provider = byokProvider("p", "Anthropic");
      const withName: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(withName);
      expect(row.label).toBe("Claude Sonnet 4.5");
      expect(row.description).toBeUndefined();
      expect(row.wireId).toBe("claude-sonnet-4-5");

      const sameAsId: Candidate = {
        configuredModel: model("cm2", "p", "raw-id"),
        provider,
        enabled: false,
      };
      expect(toRow(sameAsId).description).toBeUndefined();
    });

    it("prefers the capability blurb over the wire id for the description line", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const candidate: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "default",
            displayName: "Default (recommended)",
            description: "Opus 4.7 with 1M context · Most capable for complex work",
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(candidate);
      expect(row.label).toBe("Default (recommended)");
      expect(row.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
    });

    it("derives the vision capability from info.modalities (for the row's icon)", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const visionRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "claude-sonnet-4-5",
            displayName: "Claude Sonnet 4.5",
            modalities: { input: ["text", "image"] },
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(visionRow.capabilities).toContain(ModelCapability.VISION);
    });

    it("leaves capabilities undefined for an unknown snapshot, defined for a known one", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const unknownRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(unknownRow.capabilities).toBeUndefined();

      const knownNoVisionRow = toRow({
        configuredModel: {
          configuredModelId: "cm2",
          providerId: "claude",
          info: { id: "text-only", displayName: "Text Only", modalities: { input: ["text"] } },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(knownNoVisionRow.capabilities).toBeDefined();
      expect(knownNoVisionRow.capabilities).not.toContain(ModelCapability.VISION);
    });

    it("flags opencode Zen models (opencode/ wire id) as free, others not", () => {
      const provider = agentProvider("oc", "opencode", "opencode");
      const zen = toRow({
        configuredModel: model("z", "oc", "opencode/big-pickle"),
        provider,
        enabled: false,
      });
      const lms = toRow({
        configuredModel: model("l", "oc", "lmstudio/gpt-oss-20b"),
        provider,
        enabled: false,
      });
      const byok = toRow({
        configuredModel: model("b", "p", "claude-sonnet-4-5"),
        provider: byokProvider("p", "Anthropic"),
        enabled: false,
      });
      expect(zen.isFree).toBe(true);
      expect(lms.isFree).toBe(false);
      expect(byok.isFree).toBe(false);
    });
  });

  describe("rowMatches()", () => {
    it("matches a model by its wire id even when the label differs", () => {
      const row = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider: byokProvider("p", "Anthropic"),
        enabled: true,
      });
      expect(rowMatches(row, "claude-sonnet-4-5")).toBe(true);
      expect(rowMatches(row, "sonnet")).toBe(true);
      expect(rowMatches(row, "gpt")).toBe(false);
    });
  });

  describe("buildModelEnableGroups()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const ocAgent = agentProvider("oc-agent", "opencode", "opencode");

    it("opencode: BYOK group plus opencode-only sub-groups derived from the wire prefix", () => {
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-byok", "byok-1", "claude-sonnet-4-5"),
            provider: byok,
            enabled: true,
          },
        ],
        agentOriginCandidates: [
          {
            configuredModel: model("m-oc1", "oc-agent", "opencode/big-pickle"),
            provider: ocAgent,
            enabled: false,
          },
          {
            configuredModel: model("m-oc2", "oc-agent", "openrouter/x"),
            provider: ocAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, true, "", false);
      const byokGroup = groups.find((g) => g.key === "byok:byok-1");
      expect(byokGroup?.label).toBe("Anthropic");

      const openGroup = groups.find((g) => g.label === "opencode");
      const routerGroup = groups.find((g) => g.label === "openrouter");
      expect(openGroup?.rows.map((r) => r.id)).toEqual(["m-oc1"]);
      expect(routerGroup?.rows.map((r) => r.id)).toEqual(["m-oc2"]);
    });

    it("names each provider group's destination for https://github.com/logancyang/obsidian-copilot/issues/2889", () => {
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-byok", "byok-1", "claude-sonnet-4-5"),
            provider: byok,
            enabled: true,
          },
        ],
        agentOriginCandidates: [
          {
            configuredModel: model("m-oc1", "oc-agent", "opencode/big-pickle"),
            provider: ocAgent,
            enabled: false,
          },
          {
            configuredModel: model("m-oc2", "oc-agent", "openrouter/x"),
            provider: ocAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, true, "", false);
      expect(groups.map((g) => [g.label, g.destination])).toEqual([
        ["Anthropic", { kind: "cloud", label: "Anthropic" }],
        ["opencode", { kind: "cloud", label: "OpenCode Zen" }],
        ["openrouter", { kind: "cloud", label: "openrouter" }],
      ]);
    });

    it("filters rows by the search query and drops empty groups", () => {
      const partition = {
        byokPlusCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-oc1", "oc-agent", "opencode/big-pickle"),
            provider: ocAgent,
            enabled: false,
          },
          {
            configuredModel: model("m-oc2", "oc-agent", "openrouter/x"),
            provider: ocAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, true, "pickle", false);
      expect(groups.map((g) => g.label)).toEqual(["opencode"]);
      expect(groups[0].rows.map((r) => r.id)).toEqual(["m-oc1"]);
    });

    it("claude/codex: agent-origin rows render as a single provider group", () => {
      const codexAgent = agentProvider("codex-agent", "codex", "Codex");
      const partition = {
        byokPlusCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-codex", "codex-agent", "gpt-5"),
            provider: codexAgent,
            enabled: true,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, false, "", false);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe("Codex");
    });

    it("synthesizes a locked Copilot group for opencode when no Copilot provider is registered", () => {
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-byok", "byok-1", "claude-sonnet-4-5"),
            provider: byok,
            enabled: true,
          },
        ],
        agentOriginCandidates: [],
      };

      const groups = buildModelEnableGroups(partition, true, "", true, PLUS_CATALOG);

      expect(groups[0].label).toBe("Copilot");
      expect(groups[0].badge).toBe("privacy");
      expect(groups[0].destination).toEqual({ kind: "lock", label: "Brevilabs servers (US)" });
      expect(groups[0].destinationNote).toBe("Copilot license required");
      expect(groups[0].highlight).toBe(true);
      expect(groups[0].rows.length).toBeGreaterThan(0);
      expect(groups[0].rows.every((row) => row.locked && !row.enabled)).toBe(true);
    });

    it("adds no locked group once a Copilot provider is registered, whether or not it has rows yet", () => {
      const plusProvider: Provider = {
        providerId: "plus-1",
        providerType: "openai-compatible",
        displayName: "Copilot",
        origin: { kind: "copilot-plus" },
        addedAt: 0,
      };
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-plus", "plus-1", "copilot-plus-flash"),
            provider: plusProvider,
            enabled: true,
          },
        ],
        agentOriginCandidates: [],
      };

      const withRows = buildModelEnableGroups(partition, true, "", false);
      const beforeRows = buildModelEnableGroups(
        { byokPlusCandidates: [], agentOriginCandidates: [] },
        true,
        "",
        false
      );

      expect(withRows.filter((g) => g.label === "Copilot")).toHaveLength(1);
      expect(withRows[0].rows.every((row) => row.locked)).toBe(false);
      expect(beforeRows).toHaveLength(0);
    });

    it("adds no locked group for an agent that cannot route Copilot models", () => {
      const partition = {
        byokPlusCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-cx", "cx-agent", "gpt-5-codex"),
            provider: agentProvider("cx-agent", "codex", "Codex"),
            enabled: true,
          },
        ],
      };

      const groups = buildModelEnableGroups(partition, false, "", true);

      expect(groups.some((g) => g.rows.some((row) => row.locked))).toBe(false);
    });

    it("filters the locked rows by the search query like any others", () => {
      const empty = { byokPlusCandidates: [], agentOriginCandidates: [] };

      const matching = buildModelEnableGroups(empty, true, "flash", true, PLUS_CATALOG);
      const missing = buildModelEnableGroups(empty, true, "no-such-model", true, PLUS_CATALOG);

      expect(matching[0].rows.length).toBeGreaterThan(0);
      expect(matching[0].rows.every((row) => /flash/i.test(row.label + row.wireId))).toBe(true);
      expect(missing).toHaveLength(0);
    });

    it("badges non-Plus origins when the list mixes origins (opencode)", () => {
      const plusProvider: Provider = {
        providerId: "plus-1",
        providerType: "anthropic",
        displayName: "Copilot Plus",
        origin: { kind: "copilot-plus" },
        addedAt: 0,
      };
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-byok", "byok-1", "claude-sonnet-4-5"),
            provider: byok,
            enabled: true,
          },
          {
            configuredModel: model("m-plus", "plus-1", "gpt-5"),
            provider: plusProvider,
            enabled: false,
          },
        ],
        agentOriginCandidates: [
          {
            configuredModel: model("m-oc", "oc-agent", "opencode/big-pickle"),
            provider: ocAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, true, "", false);
      expect(groups.find((g) => g.key === "byok:byok-1")?.badge).toBe("BYOK");
      expect(groups.find((g) => g.label === "opencode")?.badge).toBe("Agent Provided");
    });

    it("floats Copilot Plus to the top, highlights it, and gives it the privacy badge + license tooltip", () => {
      const plusProvider: Provider = {
        providerId: "plus-1",
        providerType: "anthropic",
        displayName: "Copilot Plus",
        origin: { kind: "copilot-plus" },
        addedAt: 0,
      };
      const partition = {
        byokPlusCandidates: [
          {
            configuredModel: model("m-byok", "byok-1", "claude-sonnet-4-5"),
            provider: byok,
            enabled: true,
          },
          {
            configuredModel: model("m-plus", "plus-1", "gpt-5"),
            provider: plusProvider,
            enabled: false,
          },
        ],
        agentOriginCandidates: [
          {
            configuredModel: model("m-oc", "oc-agent", "opencode/big-pickle"),
            provider: ocAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, true, "", false);
      expect(groups[0].key).toBe("byok:plus-1");
      expect(groups[0].highlight).toBe(true);
      expect(groups[0].badge).toBe("privacy");
      expect(groups[0].destination).toEqual({ kind: "lock", label: "Brevilabs servers (US)" });
      expect(groups[0].destinationNote).toBeUndefined();
      expect(groups.find((g) => g.key === "byok:byok-1")?.highlight).toBeUndefined();
    });

    it("omits badges when the list has a single origin (claude/codex)", () => {
      const codexAgent = agentProvider("codex-agent", "codex", "Codex");
      const partition = {
        byokPlusCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-codex", "codex-agent", "gpt-5"),
            provider: codexAgent,
            enabled: true,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, false, "", false);
      expect(groups[0].badge).toBeUndefined();
    });
  });
});
