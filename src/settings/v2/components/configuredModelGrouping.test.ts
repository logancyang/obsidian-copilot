import {
  buildModelEnableGroups,
  opencodeOnlySubGroupLabel,
  partitionCandidates,
  rowMatches,
  toRow,
  type Candidate,
} from "./configuredModelGrouping";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { ModelCapability } from "@/constants";

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

describe("partitionCandidates", () => {
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
    expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m-byok"]);
    expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m-oc"]);
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
    // An azure/bedrock-style BYOK provider with no catalog back-reference is
    // unroutable by opencode; the predicate rejects it so it never renders.
    const unroutable: Provider = {
      providerId: "byok-azure",
      providerType: "azure",
      displayName: "Azure",
      origin: { kind: "byok" }, // no catalogProviderId → unroutable
      addedAt: 0,
    };
    const withUnroutable = {
      ...providers,
      [unroutable.providerId]: unroutable,
    };
    const allModels = [...models, model("m-azure", "byok-azure", "gpt-4o")];
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
    // Only the routable BYOK provider survives; the azure row is dropped.
    expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m-byok"]);
  });

  it("opencode: keeps every BYOK/Plus provider when no routability predicate is given", () => {
    const unroutable: Provider = {
      providerId: "byok-azure",
      providerType: "azure",
      displayName: "Azure",
      origin: { kind: "byok" },
      addedAt: 0,
    };
    const allModels = [...models, model("m-azure", "byok-azure", "gpt-4o")];
    const { byokPlusCandidates } = partitionCandidates(
      allModels,
      { ...providers, [unroutable.providerId]: unroutable },
      new Set(),
      "opencode",
      true
    );
    expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId).sort()).toEqual([
      "m-azure",
      "m-byok",
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

describe("opencodeOnlySubGroupLabel", () => {
  const provider = agentProvider("oc-agent", "opencode", "opencode");

  it("derives the label from the wire-id prefix (first /-segment)", () => {
    expect(opencodeOnlySubGroupLabel(model("a", "oc-agent", "opencode/big-pickle"), provider)).toBe(
      "opencode"
    );
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

describe("toRow", () => {
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
    // ...but the wire id is still carried for search (just not rendered).
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

    // A model whose snapshot lacks image input carries no vision icon.
    const noVisionRow = toRow({
      configuredModel: {
        configuredModelId: "cm2",
        providerId: "claude",
        info: { id: "text-only", displayName: "Text Only", modalities: { input: ["text"] } },
        configuredAt: 0,
      },
      provider,
      enabled: true,
    });
    expect(noVisionRow.capabilities ?? []).not.toContain(ModelCapability.VISION);
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

describe("rowMatches", () => {
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
    expect(rowMatches(row, "sonnet")).toBe(true); // label still matches
    expect(rowMatches(row, "gpt")).toBe(false);
  });
});

describe("buildModelEnableGroups", () => {
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
    const groups = buildModelEnableGroups(partition, true, "");
    const byokGroup = groups.find((g) => g.key === "byok:byok-1");
    expect(byokGroup?.label).toBe("Anthropic");

    const openGroup = groups.find((g) => g.label === "opencode");
    const routerGroup = groups.find((g) => g.label === "openrouter");
    expect(openGroup?.rows.map((r) => r.id)).toEqual(["m-oc1"]);
    expect(routerGroup?.rows.map((r) => r.id)).toEqual(["m-oc2"]);
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
    const groups = buildModelEnableGroups(partition, true, "pickle");
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
    const groups = buildModelEnableGroups(partition, false, "");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Codex");
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
    const groups = buildModelEnableGroups(partition, true, "");
    expect(groups.find((g) => g.key === "byok:byok-1")?.badge).toBe("BYOK");
    expect(groups.find((g) => g.label === "opencode")?.badge).toBe("Agent Provided");
  });

  it("floats Copilot Plus to the top, highlights it, and gives it no redundant badge", () => {
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
    const groups = buildModelEnableGroups(partition, true, "");
    // Copilot Plus is first regardless of candidate order.
    expect(groups[0].key).toBe("byok:plus-1");
    expect(groups[0].highlight).toBe(true);
    expect(groups[0].badge).toBeUndefined();
    // Non-Plus groups are not highlighted.
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
    const groups = buildModelEnableGroups(partition, false, "");
    expect(groups[0].badge).toBeUndefined();
  });
});
