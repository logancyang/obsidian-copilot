import { AgentSetupApi } from "./AgentSetupApi";

import type { CatalogDownloadService } from "@/modelManagement/catalog/CatalogDownloadService";
import { createTestRegistries, type TestRegistries } from "@/modelManagement/testRegistries";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { AgentType } from "@/modelManagement/types/persisted";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const CLAUDE_CATALOG: CatalogProvider = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic",
  models: {
    "claude-sonnet-4-5": {
      id: "claude-sonnet-4-5",
      displayName: "Claude Sonnet 4.5",
      reasoning: true,
    },
    "claude-opus-4-5": { id: "claude-opus-4-5", displayName: "Claude Opus 4.5" },
  },
};

const GOOGLE_CATALOG: CatalogProvider = {
  id: "google",
  displayName: "Google",
  providerType: "google",
  models: {
    "gemini-2-5-pro": { id: "gemini-2-5-pro", displayName: "Gemini 2.5 Pro" },
    "gemini-2-5-flash": { id: "gemini-2-5-flash", displayName: "Gemini 2.5 Flash" },
  },
};

interface Harness extends TestRegistries {
  api: AgentSetupApi;
  ensureLoaded: jest.Mock;
  enabledFor(agentType: AgentType | "chat"): string[];
  configuredModelId(providerId: string, wireId: string): string;
}

function makeHarness(catalogProviders: CatalogProvider[] = [CLAUDE_CATALOG]): Harness {
  const registries = createTestRegistries();
  const ensureLoaded = jest.fn(async () => {});
  const catalog = {
    ensureLoaded,
    getAllProviders: () => catalogProviders,
  } as unknown as CatalogDownloadService;
  const api = new AgentSetupApi(
    registries.providers,
    registries.models,
    registries.backends,
    catalog,
    registries.coordinator
  );
  return {
    ...registries,
    api,
    ensureLoaded,
    enabledFor: (backend) => [...registries.backends.get(backend).enabledModels],
    configuredModelId: (providerId, wireId) =>
      registries.models.getByWireId(providerId, wireId)!.configuredModelId,
  };
}

describe("AgentSetupApi", () => {
  describe("registerAgentProvider()", () => {
    it("creates one agent-origin provider with every reported model, enrolled into that agent's backend only", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
      });

      expect(h.providers.list()).toHaveLength(1);
      const provider = h.providers.get(result.providerId)!;
      expect(provider.origin).toEqual({ kind: "agent", agentType: "claude" });
      expect(provider.providerType).toBe("anthropic");
      expect(provider.displayName).toBe("Claude Code");

      expect(result.configuredModelIds).toHaveLength(2);
      expect(
        h.models
          .listByProvider(result.providerId)
          .map((m) => m.info.id)
          .sort()
      ).toEqual(["claude-opus-4-5", "claude-sonnet-4-5"]);

      expect(h.enabledFor("claude").sort()).toEqual([...result.configuredModelIds].sort());
      expect(h.enabledFor("chat")).toEqual([]);
      expect(h.enabledFor("opencode")).toEqual([]);
      expect(h.enabledFor("codex")).toEqual([]);
    });

    it("enables only autoEnrollModelIds while still creating every reported model", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "openai-compatible",
        displayName: "opencode",
        apiKey: null,
        wireModelIds: ["opencode/a", "opencode/b", "opencode/c"],
        autoEnrollModelIds: ["opencode/a", "opencode/c"],
      });

      expect(result.configuredModelIds).toHaveLength(3);

      const enabledWireIds = h
        .enabledFor("opencode")
        .map((id) => h.models.get(id)!.info.id)
        .sort();
      expect(enabledWireIds).toEqual(["opencode/a", "opencode/c"]);
    });

    it("keeps the backend's other enabled models when auto-enrolling a subset", async () => {
      const h = makeHarness();
      await h.backends.enableModel("opencode", "pre-existing-byok-model");

      await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "openai-compatible",
        displayName: "opencode",
        apiKey: null,
        wireModelIds: ["opencode/a", "opencode/b"],
        autoEnrollModelIds: ["opencode/a"],
      });

      expect(h.enabledFor("opencode")).toContain("pre-existing-byok-model");
    });

    it("enables nothing when autoEnrollModelIds is empty", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "openai-compatible",
        displayName: "opencode",
        apiKey: null,
        wireModelIds: ["opencode/a", "opencode/b"],
        autoEnrollModelIds: [],
      });

      expect(result.configuredModelIds).toHaveLength(2);
      expect(h.enabledFor("opencode")).toEqual([]);
    });

    it("stores no API key for a CLI-managed agent registered with apiKey null", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
      });

      expect(h.providers.get(result.providerId)!.apiKeyKeychainId).toBeNull();
      expect(await h.providers.getApiKey(result.providerId)).toBeNull();
    });

    it("stores the API key of a subscription-style agent", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "anthropic",
        displayName: "OpenCode",
        apiKey: "sk-agent",
        wireModelIds: ["claude-sonnet-4-5"],
      });

      expect(await h.providers.getApiKey(result.providerId)).toBe("sk-agent");
    });

    it("lets the agent-reported name and description override catalog metadata", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
        fallbackDisplayNames: { "claude-sonnet-4-5": "Sonnet" },
        fallbackDescriptions: { "claude-sonnet-4-5": "Sonnet 4.6 · Best for everyday tasks" },
      });
      const info = h.models.listByProvider(result.providerId)[0].info;
      expect(info.displayName).toBe("Sonnet");
      expect(info.description).toBe("Sonnet 4.6 · Best for everyday tasks");
    });

    it("uses the catalog entry for a known wire id and the fallback name for an unknown one", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5", "unknown-model"],
        fallbackDisplayNames: { "unknown-model": "Unknown Model" },
      });

      const hit = h.models.getByWireId(result.providerId, "claude-sonnet-4-5")!;
      expect(hit.info.displayName).toBe("Claude Sonnet 4.5");
      expect(hit.info.reasoning).toBe(true);

      const miss = h.models.getByWireId(result.providerId, "unknown-model")!;
      expect(miss.info).toEqual({ id: "unknown-model", displayName: "Unknown Model" });
    });

    it("uses the fallback description for a wire id the catalog does not know", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["default"],
        fallbackDisplayNames: { default: "Default (recommended)" },
        fallbackDescriptions: {
          default: "Opus 4.7 with 1M context · Most capable for complex work",
        },
      });
      const info = h.models.listByProvider(result.providerId)[0].info;
      expect(info.id).toBe("default");
      expect(info.displayName).toBe("Default (recommended)");
      expect(info.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
    });

    it("names a model by its wire id when neither the catalog nor a fallback knows it", async () => {
      const h = makeHarness();
      const result = await h.api.registerAgentProvider({
        agentType: "codex",
        providerType: "openai-compatible",
        displayName: "Codex",
        apiKey: null,
        wireModelIds: ["o4-mini"],
      });
      const row = h.models.getByWireId(result.providerId, "o4-mini")!;
      expect(row.info).toEqual({ id: "o4-mini", displayName: "o4-mini" });
    });

    it("still saves every wire id using fallback names when the catalog is unreachable", async () => {
      const h = makeHarness([]);
      h.ensureLoaded.mockRejectedValueOnce(new Error("offline"));
      const result = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
        fallbackDisplayNames: { "claude-sonnet-4-5": "Sonnet (fallback)" },
      });
      const row = h.models.getByWireId(result.providerId, "claude-sonnet-4-5")!;
      expect(row.info).toEqual({ id: "claude-sonnet-4-5", displayName: "Sonnet (fallback)" });
      expect(h.enabledFor("claude")).toContain(row.configuredModelId);
    });

    it("updates the existing provider in place when registered again for the same agent and provider type", async () => {
      const h = makeHarness();
      const first = await h.api.registerAgentProvider({
        agentType: "codex",
        providerType: "openai-compatible",
        displayName: "Codex",
        apiKey: null,
        wireModelIds: ["gpt-5"],
        fallbackDisplayNames: { "gpt-5": "GPT-5" },
      });
      const modelsBefore = h.models.list();
      const enabledBefore = h.enabledFor("codex");

      const second = await h.api.registerAgentProvider({
        agentType: "codex",
        providerType: "openai-compatible",
        displayName: "Codex CLI",
        apiKey: null,
        wireModelIds: ["gpt-5"],
        fallbackDisplayNames: { "gpt-5": "GPT-5" },
      });

      expect(second.providerId).toBe(first.providerId);
      expect(h.providers.list()).toHaveLength(1);
      expect(h.providers.get(first.providerId)!.displayName).toBe("Codex CLI");
      expect(second.configuredModelIds).toEqual(first.configuredModelIds);
      expect(h.models.list()).toBe(modelsBefore);
      expect(h.enabledFor("codex")).toEqual(enabledBefore);
    });

    it("refreshes an existing model's display strings on re-register while keeping its id", async () => {
      const h = makeHarness();
      const first = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["default"],
        fallbackDisplayNames: { default: "default" },
      });
      const idBefore = h.models.listByProvider(first.providerId)[0].configuredModelId;

      await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["default"],
        fallbackDisplayNames: { default: "Default (recommended)" },
        fallbackDescriptions: {
          default: "Opus 4.7 with 1M context · Most capable for complex work",
        },
      });

      const row = h.models.listByProvider(first.providerId)[0];
      expect(row.configuredModelId).toBe(idBefore);
      expect(row.info.displayName).toBe("Default (recommended)");
      expect(row.info.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
    });

    it("adds and enrolls a newly reported wire id while keeping existing models and their enabled state", async () => {
      const h = makeHarness();
      const first = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
      });
      const sonnetId = first.configuredModelIds[0];

      const second = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
      });

      expect(second.configuredModelIds).toContain(sonnetId);
      expect(h.configuredModelId(first.providerId, "claude-sonnet-4-5")).toBe(sonnetId);
      const opusId = h.configuredModelId(first.providerId, "claude-opus-4-5");
      expect(h.enabledFor("claude").sort()).toEqual([sonnetId, opusId].sort());
    });

    it("removes a model the agent no longer reports along with its backend enrollment", async () => {
      const h = makeHarness();
      const first = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
      });
      const opusId = h.configuredModelId(first.providerId, "claude-opus-4-5");

      await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
      });

      expect(h.models.getByWireId(first.providerId, "claude-opus-4-5")).toBeUndefined();
      expect(h.enabledFor("claude")).not.toContain(opusId);
      expect(h.enabledFor("claude")).toContain(
        h.configuredModelId(first.providerId, "claude-sonnet-4-5")
      );
    });
  });

  describe("syncAgentModels()", () => {
    it("adds newly reported models as disabled and leaves the provider row untouched", async () => {
      const h = makeHarness();
      const reg = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
      });
      const sonnetId = reg.configuredModelIds[0];
      const providerBefore = h.providers.get(reg.providerId);

      const result = await h.api.syncAgentModels({
        agentType: "claude",
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
      });

      expect(h.providers.get(reg.providerId)).toBe(providerBefore);
      expect(result.removed).toEqual([]);
      expect(result.added.sort()).toEqual(
        [
          h.configuredModelId(reg.providerId, "claude-opus-4-5"),
          h.configuredModelId(reg.providerId, "claude-haiku-4-5"),
        ].sort()
      );
      expect(h.enabledFor("claude")).toEqual([sonnetId]);
    });

    it("removes a model the agent no longer reports and reports it as removed", async () => {
      const h = makeHarness();
      const reg = await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
      });
      const opusId = h.configuredModelId(reg.providerId, "claude-opus-4-5");

      const result = await h.api.syncAgentModels({
        agentType: "claude",
        wireModelIds: ["claude-sonnet-4-5"],
      });

      expect(result.removed).toEqual([opusId]);
      expect(h.models.getByWireId(reg.providerId, "claude-opus-4-5")).toBeUndefined();
      expect(h.enabledFor("claude")).not.toContain(opusId);
    });

    it("changes nothing when the reported list matches the stored models", async () => {
      const h = makeHarness();
      await h.api.registerAgentProvider({
        agentType: "claude",
        providerType: "anthropic",
        displayName: "Claude Code",
        apiKey: null,
        wireModelIds: ["claude-sonnet-4-5"],
      });
      const modelsBefore = h.models.list();
      const backendsBefore = h.backends.get("claude");

      const result = await h.api.syncAgentModels({
        agentType: "claude",
        wireModelIds: ["claude-sonnet-4-5"],
      });

      expect(result).toEqual({ added: [], removed: [] });
      expect(h.models.list()).toBe(modelsBefore);
      expect(h.backends.get("claude")).toBe(backendsBefore);
    });

    it("does nothing when no agent provider exists for the agent type", async () => {
      const h = makeHarness();
      const result = await h.api.syncAgentModels({
        agentType: "claude",
        wireModelIds: ["claude-sonnet-4-5"],
      });
      expect(result).toEqual({ added: [], removed: [] });
      expect(h.providers.list()).toEqual([]);
      expect(h.models.list()).toEqual([]);
    });

    it("removes only each provider's own vanished models when one agent has several providers", async () => {
      const h = makeHarness([CLAUDE_CATALOG, GOOGLE_CATALOG]);
      const anthropic = await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "anthropic",
        displayName: "OpenCode (Anthropic)",
        apiKey: "sk-a",
        wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
      });
      const google = await h.api.registerAgentProvider({
        agentType: "opencode",
        providerType: "google",
        displayName: "OpenCode (Google)",
        apiKey: "sk-g",
        wireModelIds: ["gemini-2-5-pro", "gemini-2-5-flash"],
      });
      const opusId = h.configuredModelId(anthropic.providerId, "claude-opus-4-5");
      const flashId = h.configuredModelId(google.providerId, "gemini-2-5-flash");
      const sonnetId = h.configuredModelId(anthropic.providerId, "claude-sonnet-4-5");
      const proId = h.configuredModelId(google.providerId, "gemini-2-5-pro");

      const result = await h.api.syncAgentModels({
        agentType: "opencode",
        wireModelIds: ["claude-sonnet-4-5", "gemini-2-5-pro", "mystery-model"],
      });

      expect(result.removed.sort()).toEqual([opusId, flashId].sort());
      expect(result.added).toEqual([]);
      expect(h.configuredModelId(anthropic.providerId, "claude-sonnet-4-5")).toBe(sonnetId);
      expect(h.configuredModelId(google.providerId, "gemini-2-5-pro")).toBe(proId);
      expect(h.enabledFor("opencode").sort()).toEqual([sonnetId, proId].sort());
    });
  });
});
