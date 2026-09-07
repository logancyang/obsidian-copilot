import { DEFAULT_SETTINGS } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { planByokEmbeddingRemoval } from "./byokEmbeddingRemovalMigration";

function fixture(): CopilotSettings {
  const providers: Record<string, Provider> = {
    byok: {
      providerId: "byok",
      providerType: "openai-compatible",
      displayName: "OpenAI",
      origin: { kind: "byok", catalogProviderId: "openai" },
      apiKeyKeychainId: "keep-key",
      addedAt: 0,
    },
    plus: {
      providerId: "plus",
      providerType: "openai-compatible",
      displayName: "Plus",
      origin: { kind: "copilot-plus" },
      addedAt: 0,
    },
    agent: {
      providerId: "agent",
      providerType: "openai-compatible",
      displayName: "Agent",
      origin: { kind: "agent", agentType: "opencode" },
      addedAt: 0,
    },
  };
  const configuredModels: ConfiguredModel[] = [
    {
      configuredModelId: "chat",
      providerId: "byok",
      info: { id: "gpt-5", displayName: "Chat" },
      configuredAt: 0,
    },
    {
      configuredModelId: "embed",
      providerId: "byok",
      info: { id: "text-embedding-3-small", displayName: "Embed", isEmbedding: false },
      configuredAt: 0,
    },
    {
      configuredModelId: "opaque",
      providerId: "byok",
      info: { id: "opaque", displayName: "Opaque", isEmbedding: true },
      configuredAt: 0,
    },
    {
      configuredModelId: "plus-embed",
      providerId: "plus",
      info: { id: "embed", displayName: "Plus Embed", isEmbedding: true },
      configuredAt: 0,
    },
    {
      configuredModelId: "agent-embed",
      providerId: "agent",
      info: { id: "embed", displayName: "Agent Embed", isEmbedding: true },
      configuredAt: 0,
    },
  ];
  return {
    ...DEFAULT_SETTINGS,
    settingsVersion: 13,
    providers,
    configuredModels,
    backends: {
      chat: { enabledModels: ["chat", "embed", "plus-embed"] },
      opencode: { enabledModels: ["opaque", "agent-embed"] },
    },
    defaultModelKey: "embed",
    quickCommandModelKey: "chat",
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      backends: {
        opencode: { defaultModel: { baseModelId: "openai/text-embedding-3-small", effort: null } },
      },
    },
  };
}

describe("byokEmbeddingRemovalMigration", () => {
  describe("planByokEmbeddingRemoval()", () => {
    it("removes only BYOK embeddings and references in one patch without touching credentials (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", () => {
      const before = fixture();
      const snapshot = JSON.stringify(before);
      const patch = planByokEmbeddingRemoval(before)!;
      expect(patch.configuredModels?.map((model) => model.configuredModelId)).toEqual([
        "chat",
        "plus-embed",
        "agent-embed",
      ]);
      expect(patch.backends).toEqual({
        chat: { enabledModels: ["chat", "plus-embed"] },
        opencode: { enabledModels: ["agent-embed"] },
      });
      expect(patch.defaultModelKey).toBe("");
      expect(patch.agentMode?.backends?.opencode?.defaultModel).toBeNull();
      expect(patch).not.toHaveProperty("providers");
      expect(patch).not.toHaveProperty("quickCommandModelKey");
      expect(patch.configuredModels?.[0]).toBe(before.configuredModels[0]);
      expect(JSON.stringify(before)).toBe(snapshot);
      expect(planByokEmbeddingRemoval({ ...before, ...patch })).toBeNull();
    });
    it("preserves a wire default shared with a surviving agent inventory (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", () => {
      const before = fixture();
      before.configuredModels[4] = {
        ...before.configuredModels[4],
        info: { id: "openai/text-embedding-3-small", displayName: "Agent model" },
      };
      const patch = planByokEmbeddingRemoval(before)!;
      expect(patch).not.toHaveProperty("agentMode");
    });
    it("clears a legacy selection for a removed model and preserves unrelated defaults (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", () => {
      const before = fixture();
      const project = {
        id: "keep-project",
        name: "Project",
        systemPrompt: "",
        projectModelKey: "chat",
        modelConfigs: {},
        contextSource: {},
        created: 0,
        UsageTimestamps: 0,
      };
      before.projectList = [project, { ...project, id: "clear-model", projectModelKey: "embed" }];
      before.defaultModelKey = "chat";
      before.quickCommandModelKey = "text-embedding-3-small|openai";
      const patch = planByokEmbeddingRemoval(before)!;
      expect(patch.projectList).toEqual([
        project,
        { ...before.projectList[1], projectModelKey: "" },
      ]);
      expect(patch.projectList?.[0]).toBe(project);
      expect(patch).not.toHaveProperty("defaultModelKey");
      expect(patch).toHaveProperty("quickCommandModelKey", undefined);
    });
  });
});
