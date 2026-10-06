import { verifyOpencodeBinary } from "./OpencodeBinaryManager";
import { updateAgentModeBackendFields } from "@/settings/model";
import { logWarn } from "@/logger";
import { OPENARTIFACTS_WORKSPACE_ROOT_ENV } from "@/openArtifacts/constants";
import { getSettings, resetSettings, setSettings, updateSetting } from "@/settings/model";
import type { OpencodeBackendSettings } from "@/settings/model";
import type {
  BackendConfigRegistry,
  ConfiguredModel,
  EnabledBackendEntry,
  Provider,
  ProviderOrigin,
  ProviderRegistry,
  ProviderType,
} from "@/modelManagement";
import type { Skill } from "@/agentMode/skills";
import {
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import {
  buildOpencodeConfig,
  type GeneratedOpencodeConfig,
  OpencodeBackend,
  type OpencodeModelDeps,
} from "./OpencodeBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";

function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  updateSetting("defaultSystemPromptTitle", "");
  updateCachedSystemPrompts([]);
}

jest.mock("./OpencodeBinaryManager", () => ({
  ...jest.requireActual("./OpencodeBinaryManager"),
  verifyOpencodeBinary: jest.fn().mockResolvedValue({ stdout: "2.0.21" }),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let mockSkills: Skill[] = [];
let mockSkillManagerReady = false;

jest.mock("@/agentMode/skills", () => {
  const actual = jest.requireActual("@/agentMode/skills");
  return {
    ...actual,
    getManagedSkills: () => mockSkills,
    SkillManager: {
      hasInstance: () => mockSkillManagerReady,
      getInstance: () => {
        if (!mockSkillManagerReady) {
          throw new Error("SkillManager.getInstance called before initialize");
        }
        return { getAgentDirsProjectRel: () => ({}) } as unknown;
      },
    },
  };
});

function makeSkill(name: string, enabledAgents: Skill["enabledAgents"]): Skill {
  return {
    name,
    description: `${name} skill`,
    filePath: `/x/${name}/SKILL.md`,
    dirPath: `/x/${name}`,
    body: "",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

function seedSkills(skills: Skill[]): void {
  mockSkills = skills;
  mockSkillManagerReady = skills.length > 0;
}

function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  overrides: Partial<
    Pick<Provider, "providerType" | "baseUrl" | "displayName" | "enableCors" | "requiresApiKey">
  > = {}
): Provider {
  return {
    providerId,
    providerType: overrides.providerType ?? "anthropic",
    displayName: overrides.displayName ?? providerId,
    baseUrl: overrides.baseUrl,
    enableCors: overrides.enableCors,
    requiresApiKey: overrides.requiresApiKey ?? true,
    origin,
    addedAt: 0,
  };
}

function makeOpenAICompatibleProvider(
  providerId: string,
  baseUrl: string | undefined,
  displayName = providerId,
  requiresApiKey = true
): Provider {
  return makeProvider(
    providerId,
    { kind: "byok" },
    { providerType: "openai-compatible" as ProviderType, baseUrl, displayName, requiresApiKey }
  );
}

function makeModel(providerId: string, wireId: string): ConfiguredModel {
  return {
    configuredModelId: `cm-${providerId}-${wireId}`,
    providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
}

function okEntry(provider: Provider, model: ConfiguredModel): EnabledBackendEntry {
  return {
    configuredModelId: model.configuredModelId,
    state: "ok",
    configuredModel: model,
    provider,
  };
}

function makeDeps(args: {
  resolved: EnabledBackendEntry[];
  keys?: Record<string, string | null>;
}): OpencodeModelDeps {
  const keys = args.keys ?? {};
  return {
    backendConfigRegistry: {
      resolveEnabled: (backend: string) => (backend === "opencode" ? args.resolved : []),
    } as unknown as BackendConfigRegistry,
    providerRegistry: {
      getApiKey: async (providerId: string) => keys[providerId] ?? null,
    } as unknown as ProviderRegistry,
    getSelfHostWebSearchChannel: async () => ({
      url: "http://127.0.0.1:1234/search",
      token: "session-token",
    }),
  };
}

function makePlusProvider(): Provider {
  return makeProvider(
    "p-plus",
    { kind: "copilot-plus" },
    {
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      baseUrl: "https://models.brevilabs.com/v1",
    }
  );
}

function makePlusReasoningModel(wireId: string, efforts?: readonly string[]): ConfiguredModel {
  const model = makeModel("p-plus", wireId);
  model.info.reasoning = true;
  if (efforts) model.info.reasoningEfforts = efforts;
  return model;
}

const NO_MODELS_DEPS = makeDeps({ resolved: [] });

function setOpencodeSettings(opencode: OpencodeBackendSettings): void {
  updateAgentModeBackendFields("opencode", opencode);
}

function lastRuleFor(
  cfg: GeneratedOpencodeConfig,
  agentId: string,
  action: string
): { action: string; effect: string } | undefined {
  return [...(cfg.permissions ?? []), ...(cfg.agents[agentId]?.permissions ?? [])]
    .filter((rule) => rule.action === action)
    .at(-1);
}

const QUESTION_DENY = { action: "question", resource: "*", effect: "deny" };

const COPILOT_BUILD_ASKS = [
  { action: "shell", resource: "*", effect: "ask" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "websearch", resource: "*", effect: "ask" },
];

describe("OpencodeBackend", () => {
  describe("buildOpencodeConfig()", () => {
    beforeEach(() => {
      resetSettings();
      seedSkills([]);
      resetPromptState();
    });

    beforeEach(() => {
      resetSettings();
      seedSkills([]);
      resetPromptState();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 registers a BYOK provider in OpenCode 2 config with its keychain key and model", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "claude-sonnet-4-6");
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg).not.toHaveProperty("provider");
      expect(cfg.providers.anthropic.settings).toEqual({ apiKey: "anth-123" });
      expect(cfg.providers.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
    });

    it("injects multiple models under the same provider", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const deps = makeDeps({
        resolved: [
          okEntry(provider, makeModel("p-anthropic", "claude-sonnet-4-6")),
          okEntry(provider, makeModel("p-anthropic", "claude-haiku")),
        ],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.anthropic.models).toEqual({
        "claude-sonnet-4-6": {},
        "claude-haiku": {},
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/644 preserves OpenCode catalog limits for a BYOK model with stored limits", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "claude-sonnet-4-6");
      model.info.limits = { context: 200_000 };
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers.anthropic.models?.["claude-sonnet-4-6"]).toEqual({});
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 declares image input with OpenCode 2 capabilities for a vision model", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "claude-sonnet-4-6");
      model.info.modalities = { input: ["text", "image"], output: ["text"] };
      model.info.toolCall = true;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.anthropic.models).toEqual({
        "claude-sonnet-4-6": {
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 declares only text input for a text-only model", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "deepseek-v4-flash");
      model.info.modalities = { input: ["text"], output: ["text"] };
      model.info.toolCall = true;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.anthropic.models).toEqual({
        "deepseek-v4-flash": { capabilities: { tools: true, input: ["text"], output: ["text"] } },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 uses known tool support and text-only defaults for a custom model with partial modalities", async () => {
      const provider = makeOpenAICompatibleProvider("p-custom", "https://my-endpoint/v1", "Custom");
      const model = makeModel("p-custom", "vision-preview");
      model.info.modalities = { input: ["text", "image"] };
      model.info.toolCall = false;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-custom": "secret-key" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["p-custom"].models?.["vision-preview"]).toEqual({
        capabilities: { tools: false, input: ["text", "image"], output: ["text"] },
        variants: [],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 inherits catalog effort choices for a BYOK reasoning model", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "deepseek-v4-flash");
      model.info.modalities = { input: ["text"], output: ["text"] };
      model.info.toolCall = true;
      model.info.reasoning = true;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.anthropic.models).toEqual({
        "deepseek-v4-flash": {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 inherits catalog capabilities when a BYOK model has no modality metadata", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-anthropic", "hand-typed-model"))],
        keys: { "p-anthropic": "anth-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.anthropic.models).toEqual({ "hand-typed-model": {} });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 inherits catalog capabilities when Copilot knows only some of them", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const inputOnly = makeModel("p-anthropic", "input-only");
      inputOnly.info.modalities = { input: ["text", "image"] };
      inputOnly.info.toolCall = false;
      const unknownTools = makeModel("p-anthropic", "unknown-tools");
      unknownTools.info.modalities = { input: ["text"], output: ["text", "image"] };
      const deps = makeDeps({
        resolved: [okEntry(provider, inputOnly), okEntry(provider, unknownTools)],
        keys: { "p-anthropic": "anth-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers.anthropic.models).toEqual({ "input-only": {}, "unknown-tools": {} });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 leaves catalog modalities intact when only tool support is known", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "claude-sonnet-4-6");
      model.info.toolCall = false;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers.anthropic.models?.["claude-sonnet-4-6"]).toEqual({});
    });

    it("registers each provider with its own key and models", async () => {
      const anthropic = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const openai = makeProvider("p-openai", { kind: "byok", catalogProviderId: "openai" });
      const deps = makeDeps({
        resolved: [
          okEntry(anthropic, makeModel("p-anthropic", "claude-sonnet-4-6")),
          okEntry(openai, makeModel("p-openai", "gpt-5")),
        ],
        keys: { "p-anthropic": "anth-123", "p-openai": "oai-456" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(Object.keys(cfg.providers).sort()).toEqual(["anthropic", "openai"]);
      expect(cfg.providers.openai.settings).toEqual({ apiKey: "oai-456" });
      expect(cfg.providers.openai.models).toEqual({ "gpt-5": {} });
    });

    it("skips a model when a key-requiring provider has no key in the keychain", async () => {
      const provider = makeProvider("p-openai", { kind: "byok", catalogProviderId: "openai" });
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-openai", "gpt-5"))],
        keys: { "p-openai": null },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers).toEqual({});
    });

    it("returns an empty provider map when no models are enabled", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.providers).toEqual({});
    });

    it("skips enabled entries whose model or provider cannot be resolved", async () => {
      const deps = makeDeps({
        resolved: [{ configuredModelId: "gone", state: "broken" }],
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers).toEqual({});
    });

    it("does not inject agent-origin providers because opencode hosts them", async () => {
      const provider = makeProvider("opencode-provider", {
        kind: "agent",
        agentType: "opencode",
      });
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("opencode-provider", "opencode/big-pickle"))],
        keys: { "opencode-provider": "should-not-be-read" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers).toEqual({});
    });

    it("skips a BYOK provider without a catalog id that is not OpenAI-compatible", async () => {
      const provider = makeProvider("p-google", { kind: "byok" }, { providerType: "google" });
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-google", "gemini-3-flash"))],
        keys: { "p-google": "google-key" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers).toEqual({});
    });

    it("registers a key-less OpenAI-compatible provider under its providerId with its base URL", async () => {
      const provider = makeOpenAICompatibleProvider(
        "p-ollama",
        "http://localhost:11434/v1",
        "Ollama",
        false
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-ollama", "llama3.2"))],
        keys: { "p-ollama": null },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      const entry = cfg.providers["p-ollama"];
      expect(entry.package).toBe("aisdk:@ai-sdk/openai-compatible");
      expect(entry.name).toBe("Ollama");
      expect(entry.settings?.baseURL).toBe("http://localhost:11434/v1");
      expect(entry.settings?.apiKey).toBeUndefined();
      expect(entry.models).toEqual({
        "llama3.2": {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [],
        },
      });
    });

    it("does not forward the Quick Chat CORS choice to OpenCode Agent (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      const provider = makeProvider(
        "p-custom",
        { kind: "byok" },
        {
          providerType: "openai-compatible",
          baseUrl: "https://my-endpoint/v1",
          displayName: "Custom",
          enableCors: true,
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-custom", "gpt-5.5"))],
        keys: { "p-custom": "secret-key" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["p-custom"]).not.toHaveProperty("enableCors");
      expect(cfg.providers["p-custom"].settings).not.toHaveProperty("enableCors");
    });

    it("skips an OpenAI-compatible BYOK provider with no baseUrl", async () => {
      const provider = makeOpenAICompatibleProvider("p-nobase", undefined);
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-nobase", "some-model"))],
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers).toEqual({});
    });

    it("keeps a keyless custom provider on a public host when its persisted contract allows it (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      const provider = makeOpenAICompatibleProvider(
        "p-public-keyless",
        "https://trusted-gateway.example.com/v1",
        "Trusted gateway",
        false
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-public-keyless", "qwen3.8-27b"))],
        keys: { "p-public-keyless": null },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["p-public-keyless"].settings).toEqual({
        baseURL: "https://trusted-gateway.example.com/v1",
      });
    });

    it("skips an optional-auth provider when its stored key can no longer be resolved (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      const provider = {
        ...makeOpenAICompatibleProvider(
          "p-missing-stored-key",
          "https://trusted-gateway.example.com/v1",
          "Trusted gateway",
          false
        ),
        apiKeyKeychainId: "keychain-p-missing-stored-key",
      };
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-missing-stored-key", "qwen3.8-27b"))],
        keys: { "p-missing-stored-key": null },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers).toEqual({});
    });

    it("keeps a key-less self-hosted provider even when it carries a catalog id", async () => {
      const provider = makeProvider(
        "p-ollama-catalog",
        { kind: "byok", catalogProviderId: "ollama" },
        {
          providerType: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          requiresApiKey: false,
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-ollama-catalog", "llama3.2"))],
        keys: { "p-ollama-catalog": null },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.ollama?.models).toEqual({ "llama3.2": {} });
    });

    it("omits apiKey entirely when a catalog self-hosted provider has an empty-string keychain entry", async () => {
      const provider = makeProvider(
        "p-ollama-catalog",
        { kind: "byok", catalogProviderId: "ollama" },
        {
          providerType: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          requiresApiKey: false,
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-ollama-catalog", "llama3.2"))],
        keys: { "p-ollama-catalog": "" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      const opts = cfg.providers.ollama?.settings ?? {};
      expect(opts).not.toHaveProperty("apiKey");
    });

    it("passes a custom base URL through for a catalog provider without naming an SDK package", async () => {
      const provider = makeProvider(
        "p-openai",
        { kind: "byok", catalogProviderId: "openai" },
        { providerType: "openai-compatible", baseUrl: "https://my-proxy.example.com/v1" }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-openai", "gpt-5"))],
        keys: { "p-openai": "oai-456" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      const entry = cfg.providers.openai;
      expect(entry.package).toBeUndefined();
      expect(entry.settings).toEqual({
        apiKey: "oai-456",
        baseURL: "https://my-proxy.example.com/v1",
      });
    });

    it("omits the base URL when a catalog provider uses its own default endpoint", async () => {
      const provider = makeProvider(
        "p-google",
        { kind: "byok", catalogProviderId: "google" },
        {
          providerType: "google" as ProviderType,
          baseUrl: "https://generativelanguage.googleapis.com",
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-google", "gemini-2.5-flash"))],
        keys: { "p-google": "g-123" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      expect(cfg.providers.google.settings).toEqual({ apiKey: "g-123" });
    });

    it("registers Copilot Plus as an OpenAI-compatible provider with its token, base URL, and client version header", async () => {
      const provider = makeProvider(
        "p-plus",
        { kind: "copilot-plus" },
        {
          providerType: "openai-compatible",
          displayName: "Copilot Plus",
          baseUrl: "https://models.brevilabs.com/v1",
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-plus", "copilot-plus-flash"))],
        keys: { "p-plus": "plus-token-123" },
      });
      deps.clientVersion = "4.0.0-preview-260802";
      const cfg = await buildOpencodeConfig(getSettings(), deps);
      const cp = cfg.providers["copilot-plus"];
      expect(cp.package).toBe("aisdk:@ai-sdk/openai-compatible");
      expect(cp.name).toBe("Copilot Plus");
      expect(cp.settings?.baseURL).toBe("https://models.brevilabs.com/v1");
      expect(cp.settings?.apiKey).toBe("plus-token-123");
      expect(cp.headers).toEqual({
        "X-Client-Version": "4.0.0-preview-260802",
      });
      expect(cp.models).toEqual({
        "copilot-plus-flash": {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: [],
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/644 passes a published 1M context window to OpenCode for a Copilot Plus model", async () => {
      const model = makeModel("p-plus", "deepseek-v4-pro");
      model.info.limits = { context: 1024 * 1024 };
      const deps = makeDeps({
        resolved: [okEntry(makePlusProvider(), model)],
        keys: { "p-plus": "plus-token-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["copilot-plus"].models?.["deepseek-v4-pro"]).toEqual({
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 1024 * 1024 },
        variants: [],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 offers only the effort levels Copilot Plus published", async () => {
      const model = makePlusReasoningModel("copilot-plus-flash", ["high", "max"]);
      const deps = makeDeps({
        resolved: [okEntry(makePlusProvider(), model)],
        keys: { "p-plus": "plus-token-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["copilot-plus"].models?.["copilot-plus-flash"]).toEqual({
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [
          { id: "high", settings: { reasoningEffort: "high" } },
          { id: "max", settings: { reasoningEffort: "max" } },
        ],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 offers no effort control when Copilot Plus publishes no levels", async () => {
      const deps = makeDeps({
        resolved: [okEntry(makePlusProvider(), makePlusReasoningModel("honors-no-level", []))],
        keys: { "p-plus": "plus-token-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["copilot-plus"].models?.["honors-no-level"]).toEqual({
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 disables OpenCode's model-id effort guesses so glm-5.2 offers only its published levels", async () => {
      const deps = makeDeps({
        resolved: [
          okEntry(makePlusProvider(), makePlusReasoningModel("glm-5.2", ["none", "high"])),
        ],
        keys: { "p-plus": "plus-token-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.plugins).toEqual(["-opencode.variant"]);
      expect(cfg.providers["copilot-plus"].models?.["glm-5.2"]?.variants).toEqual([
        { id: "none", settings: { reasoningEffort: "none" } },
        { id: "high", settings: { reasoningEffort: "high" } },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 offers no effort levels when Copilot Plus levels are unknown, leaving the model at its default", async () => {
      const deps = makeDeps({
        resolved: [okEntry(makePlusProvider(), makePlusReasoningModel("copilot-plus-flash"))],
        keys: { "p-plus": "plus-token-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["copilot-plus"].models?.["copilot-plus-flash"]).toEqual({
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 inherits catalog effort choices even when a BYOK row carries levels", async () => {
      const provider = makeProvider("p-anthropic", {
        kind: "byok",
        catalogProviderId: "anthropic",
      });
      const model = makeModel("p-anthropic", "copilot-plus-flash");
      model.info.reasoning = true;
      model.info.reasoningEfforts = ["none", "low"];
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-anthropic": "anth-123" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers.anthropic.models?.["copilot-plus-flash"]).toEqual({});
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/557 offers no effort levels for a custom BYOK reasoning model, leaving it at its default", async () => {
      const provider = makeOpenAICompatibleProvider("p-custom", "https://my-endpoint/v1", "Custom");
      const model = makeModel("p-custom", "reasoner");
      model.info.reasoning = true;
      const deps = makeDeps({
        resolved: [okEntry(provider, model)],
        keys: { "p-custom": "secret-key" },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers["p-custom"].models?.reasoner).toEqual({
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
      });
    });

    it("skips Copilot Plus when its provisioned relay token is unavailable (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      const provider = makeProvider(
        "p-plus",
        { kind: "copilot-plus" },
        {
          providerType: "openai-compatible",
          baseUrl: "https://models.brevilabs.com/v1",
          requiresApiKey: false,
        }
      );
      const deps = makeDeps({
        resolved: [okEntry(provider, makeModel("p-plus", "copilot-plus-flash"))],
        keys: { "p-plus": null },
      });

      const cfg = await buildOpencodeConfig(getSettings(), deps);

      expect(cfg.providers).toEqual({});
    });

    it("leaves the top-level model unset when a default model is persisted", async () => {
      setOpencodeSettings({
        binaryPath: "/x",
        defaultModel: { baseModelId: "opencode/big-pickle", effort: "high" },
      });
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.model).toBeUndefined();
    });

    it("selects copilot-build as the default agent", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.default_agent).toBe("copilot-build");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/559 denies OpenCode's native question tool for every agent", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.permissions).toEqual([QUESTION_DENY]);
    });

    it("configures copilot-build as a primary agent that asks before shell, edit, and web search", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.agents["copilot-build"].mode).toBe("primary");
      expect(cfg.agents["copilot-build"].permissions).toEqual(COPILOT_BUILD_ASKS);
    });

    it("gives both agents the shared product prompt, byte for byte", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.agents["copilot-build"].system).toBe(buildAgentSystemPrompt("opencode"));
      expect(cfg.agents.build.system).toBe(buildAgentSystemPrompt("opencode"));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 names only the builtin skills enabled for OpenCode in both agent prompts", async () => {
      const agentMode = getSettings().agentMode;
      updateSetting("agentMode", {
        ...agentMode,
        skills: {
          ...agentMode.skills,
          builtinPreferences: { "copilot-web-search": { disabledAgents: ["opencode"] } },
        },
      });

      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      for (const id of ["copilot-build", "build"]) {
        expect(cfg.agents[id].system).not.toContain("copilot-web-search");
        expect(cfg.agents[id].system).toContain("copilot-web-fetch for pages/URLs");
      }
    });

    it("leaves AGENTS.md discovery to opencode instead of inlining instruction text", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.instructions).toBeUndefined();
      expect(cfg.agents["copilot-build"].system).not.toContain("AGENTS.md instructions:");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 denies native web tools for every Self-Host opencode agent", async () => {
      setSettings({ enableSelfHostMode: true });

      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.permissions).toEqual([
        QUESTION_DENY,
        { action: "websearch", resource: "*", effect: "deny" },
        { action: "webfetch", resource: "*", effect: "deny" },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 selects OpenCode's rotating keyless web search provider so native search never stops to ask for one", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(cfg.websearch).toEqual({ provider: "random" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 asks before native web search in the ask-first agent while Auto keeps it allowed", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(lastRuleFor(cfg, "copilot-build", "websearch")?.effect).toBe("ask");
      expect(lastRuleFor(cfg, "build", "websearch")).toBeUndefined();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 keeps native web search denied for the ask-first agent in Self-Host Mode", async () => {
      setSettings({ enableSelfHostMode: true });

      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

      expect(lastRuleFor(cfg, "copilot-build", "websearch")?.effect).toBe("deny");
      expect(lastRuleFor(cfg, "build", "websearch")?.effect).toBe("deny");
    });

    it("denies only skills enabled for another agent and not for opencode", async () => {
      seedSkills([
        makeSkill("a", ["claude"]),
        makeSkill("b", ["claude", "opencode"]),
        makeSkill("c", []),
        makeSkill("d", ["opencode"]),
        makeSkill("e", ["codex"]),
      ]);
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.permissions).toEqual([
        QUESTION_DENY,
        { action: "skill", resource: "a", effect: "deny" },
        { action: "skill", resource: "e", effect: "deny" },
      ]);
    });

    it("adds no skill denies before the SkillManager is initialised", async () => {
      mockSkills = [makeSkill("foo", ["claude"])];
      mockSkillManagerReady = false;
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.permissions).toEqual([QUESTION_DENY]);
    });

    it("allows external_directory access to the cache root for both agents", async () => {
      const cfg = await buildOpencodeConfig(
        getSettings(),
        NO_MODELS_DEPS,
        "/home/u/.obsidian-copilot/vaults/abc123/context-cache"
      );
      const allow = {
        action: "external_directory",
        resource: "/home/u/.obsidian-copilot/vaults/abc123/context-cache/**",
        effect: "allow",
      };
      expect(cfg.agents.build.permissions).toEqual([allow]);
      expect(cfg.agents["copilot-build"].permissions).toEqual([...COPILOT_BUILD_ASKS, allow]);
    });

    it("adds no external_directory allow when no cache root is provided", async () => {
      const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
      expect(cfg.agents.build.permissions).toBeUndefined();
      expect(cfg.agents["copilot-build"].permissions).toEqual(COPILOT_BUILD_ASKS);
    });
  });

  describe("OpencodeBackend", () => {
    describe("planUsageAppliesTo()", () => {
      it.each([
        ["a Copilot Plus model", "copilot-plus/copilot-plus-flash", true],
        ["a BYOK model on the user's own key", "anthropic/claude-sonnet-4-6", false],
        ["no model", null, false],
      ])(
        "https://github.com/logancyang/obsidian-copilot-preview/issues/193 reports plan usage applies for %s: %s",
        (_label, wireModelId, expected) => {
          expect(new OpencodeBackend(NO_MODELS_DEPS).planUsageAppliesTo(wireModelId)).toBe(
            expected
          );
        }
      );
    });

    describe("buildSpawnDescriptor()", () => {
      beforeEach(() => {
        resetSettings();
        seedSkills([]);
        resetPromptState();
        (logWarn as jest.Mock).mockClear();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/569 rejects a V1 executable even when settings claim a supported V2 version", async () => {
        updateAgentModeBackendFields("opencode", {
          binaryPath: "/old-opencode",
          binaryVersion: "2.0.21",
          binarySource: "managed",
        });
        jest.mocked(verifyOpencodeBinary).mockResolvedValueOnce({ stdout: "1.18.31" });
        await expect(
          new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow("1.18.31");
        expect(verifyOpencodeBinary).toHaveBeenCalledWith("/old-opencode");
      });

      it("rejects when no binary is installed", async () => {
        const backend = new OpencodeBackend(NO_MODELS_DEPS);
        await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
          /binary not installed/
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/555 launches ACP in the vault without the removed --cwd argument and injects enabled models", async () => {
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          binaryVersion: "1.3.17",
          binarySource: "managed",
        });
        const provider = makeProvider("p-anthropic", {
          kind: "byok",
          catalogProviderId: "anthropic",
        });
        const deps = makeDeps({
          resolved: [okEntry(provider, makeModel("p-anthropic", "claude-sonnet-4-6"))],
          keys: { "p-anthropic": "anth-xyz" },
        });
        const backend = new OpencodeBackend(deps);
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
        expect(desc.command).toBe("/path/to/opencode");
        expect(desc.args).toEqual(["acp", "--print-logs"]);
        expect(desc.cwd).toBe("/vault/abs");
        expect(desc.env[OPENARTIFACTS_WORKSPACE_ROOT_ENV]).toBe("/vault/abs");
        expect(desc.env.OPENCODE_CONFIG_CONTENT).toBeDefined();
        const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
        expect(cfg.providers.anthropic.settings).toEqual({ apiKey: "anth-xyz" });
        expect(cfg.providers.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/650 runs OpenCode at INFO so server failure causes reach its stderr and log file", async () => {
        setOpencodeSettings({ binaryPath: "/path/to/opencode" });

        const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
          vaultBasePath: "/vault",
        });

        expect(desc.env.OPENCODE_LOG_LEVEL).toBe("INFO");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 lets a user opt into more detailed OpenCode logs", async () => {
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_LOG_LEVEL: "DEBUG" },
        });

        const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
          vaultBasePath: "/vault",
        });

        expect(desc.args).toEqual(["acp", "--print-logs"]);
        expect(desc.env.OPENCODE_LOG_LEVEL).toBe("DEBUG");
      });

      it("passes the plugin version to built-in Copilot Plus skills through the environment", async () => {
        setSettings({ isPaidUser: true, plusLicenseKey: "plus-token", userId: "user-1" });
        setOpencodeSettings({ binaryPath: "/path/to/opencode" });
        const backend = new OpencodeBackend({
          ...NO_MODELS_DEPS,
          clientVersion: "4.0.0-preview-260802",
        });

        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });

        expect(desc.env.COPILOT_CLIENT_VERSION).toBe("4.0.0-preview-260802");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 gives global and Project sessions the same protected active-vault Miyo identity", async () => {
        setSettings({ miyoSearchAll: false });
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: {
            [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
            [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
          },
        });

        const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
          vaultBasePath: "/active-vault",
          vaultName: "active-vault",
        });

        expect(desc.args).toEqual(["acp", "--print-logs"]);
        expect(desc.cwd).toBe("/active-vault");
        expect(desc.env[MIYO_SEARCH_SCOPE_ENV]).toBe("current");
        expect(desc.env[MIYO_SEARCH_FOLDER_ENV]).toBe("active-vault");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/558 ends top-level and every agent permission override with web denies in Self-Host Mode", async () => {
        setSettings({ enableSelfHostMode: true });
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: {
            [SELF_HOST_WEB_SEARCH_ENV]: "",
            [SELF_HOST_WEB_SEARCH_URL_ENV]: "http://attacker.invalid",
            [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "replacement-token",
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "websearch", resource: "*", effect: "allow" },
              ],
              agents: {
                build: {
                  permissions: [{ action: "webfetch", resource: "*", effect: "allow" }],
                },
                custom: { permissions: [{ action: "*", resource: "*", effect: "allow" }] },
                empty: { description: "No rule yet" },
              },
            }),
          },
        });

        const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
          vaultBasePath: "/active-vault",
          vaultName: "active-vault",
        });
        const cfg = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);

        expect(desc.env[SELF_HOST_WEB_SEARCH_ENV]).toBe("1");
        expect(desc.env[SELF_HOST_WEB_SEARCH_URL_ENV]).toBe("http://127.0.0.1:1234/search");
        expect(desc.env[SELF_HOST_WEB_SEARCH_TOKEN_ENV]).toBe("session-token");
        const denies = [
          { action: "websearch", resource: "*", effect: "deny" },
          { action: "webfetch", resource: "*", effect: "deny" },
        ];
        expect(cfg.permissions).toEqual([
          { action: "*", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          ...denies,
        ]);
        expect(cfg.agents.build.permissions).toEqual([
          { action: "webfetch", resource: "*", effect: "allow" },
          ...denies,
        ]);
        expect(cfg.agents.custom.permissions).toEqual([
          { action: "*", resource: "*", effect: "allow" },
          ...denies,
        ]);
        expect(cfg.agents.empty).toEqual({ description: "No rule yet", permissions: denies });
      });

      it.each(["permission", "tools", "agent", "mode"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/558 rejects a Self-Host config override that sets the OpenCode 1 `%s` key",
        async (legacyKey) => {
          setSettings({ enableSelfHostMode: true });
          setOpencodeSettings({
            binaryPath: "/path/to/opencode",
            envOverrides: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ [legacyKey]: {} }) },
          });

          await expect(
            new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({ vaultBasePath: "/vault" })
          ).rejects.toThrow(`OpenCode 1 keys (${legacyKey})`);
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 refuses to start Self-Host OpenCode before the replacement search channel is available", async () => {
        setSettings({ enableSelfHostMode: true });
        setOpencodeSettings({ binaryPath: "/path/to/opencode" });
        const deps = makeDeps({ resolved: [] });
        delete deps.getSelfHostWebSearchChannel;

        await expect(
          new OpencodeBackend(deps).buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow("self-host web search channel is unavailable");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects a non-object config override instead of starting without native web denies", async () => {
        setSettings({ enableSelfHostMode: true });
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "[]" },
        });

        await expect(
          new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow("OPENCODE_CONFIG_CONTENT must be a JSON object");
      });

      it("allows external_directory access to the cache root supplied by getCacheRoot", async () => {
        setOpencodeSettings({ binaryPath: "/path/to/opencode" });
        const deps: OpencodeModelDeps = {
          ...NO_MODELS_DEPS,
          getCacheRoot: () => "/cache/root",
        };
        const backend = new OpencodeBackend(deps);
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
        const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
        const allow = { action: "external_directory", resource: "/cache/root/**", effect: "allow" };
        expect(cfg.agents.build.permissions).toEqual([allow]);
        expect(cfg.agents["copilot-build"].permissions).toEqual([...COPILOT_BUILD_ASKS, allow]);
        expect(logWarn).not.toHaveBeenCalled();
      });

      it("warns when an OPENCODE_CONFIG_CONTENT override drops the cache allow rule", async () => {
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "{}" },
        });
        const deps: OpencodeModelDeps = {
          ...NO_MODELS_DEPS,
          getCacheRoot: () => "/cache/root",
        };
        const backend = new OpencodeBackend(deps);
        await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
        expect(logWarn).toHaveBeenCalledWith(
          expect.stringContaining("external_directory allow rule is dropped")
        );
      });

      it("adds no allow rule and no warning when getCacheRoot returns blank text", async () => {
        setOpencodeSettings({ binaryPath: "/path/to/opencode" });
        const deps: OpencodeModelDeps = {
          ...NO_MODELS_DEPS,
          getCacheRoot: () => "   ",
        };
        const backend = new OpencodeBackend(deps);
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
        const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
        expect(cfg.agents.build.permissions).toBeUndefined();
        expect(cfg.agents["copilot-build"].permissions).toEqual(COPILOT_BUILD_ASKS);
        expect(logWarn).not.toHaveBeenCalled();
      });

      it("skips building the generated config when an override replaces it (https://github.com/logancyang/obsidian-copilot/issues/2917)", async () => {
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: '{"model":"custom"}' },
        });
        const resolveEnabled = jest.fn(() => [
          okEntry(makePlusProvider(), makePlusReasoningModel("copilot-plus-flash")),
        ]);
        const backend = new OpencodeBackend({
          ...makeDeps({ resolved: [], keys: { "p-plus": "plus-token-123" } }),
          backendConfigRegistry: { resolveEnabled } as unknown as BackendConfigRegistry,
        });

        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });

        expect(desc.env.OPENCODE_CONFIG_CONTENT).toBe('{"model":"custom"}');
        expect(resolveEnabled).not.toHaveBeenCalled();
      });

      it("does not warn about a config override when no cache root is resolved", async () => {
        setOpencodeSettings({
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "{}" },
        });
        const backend = new OpencodeBackend(NO_MODELS_DEPS);
        await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
        expect(logWarn).not.toHaveBeenCalled();
      });
    });
  });
});
