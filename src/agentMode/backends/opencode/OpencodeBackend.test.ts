import { verifyOpencodeBinary } from "./OpencodeBinaryManager";
import { updateAgentModeBackendFields } from "@/settings/model";
import { ChatModelProviders } from "@/constants";
import { logWarn } from "@/logger";
import { OPENARTIFACTS_WORKSPACE_ROOT_ENV } from "@/openArtifacts/constants";
import { getSettings, resetSettings, setSettings, updateSetting } from "@/settings/model";
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
import type { UserSystemPrompt } from "@/system-prompts/type";
import {
  buildOpencodeConfig,
  type GeneratedOpencodeConfig,
  OPENCODE_PROVIDER_MAP,
  OpencodeBackend,
  type OpencodeModelDeps,
} from "./OpencodeBackend";
import {
  buildAgentSystemPrompt,
  COPILOT_PROMPT_BASE,
} from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";

function makeSystemPrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

/** The system-prompt jotai store is module-global — reset it between tests. */
function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  updateSetting("defaultSystemPromptTitle", "");
  updateCachedSystemPrompts([]);
}

jest.mock("./OpencodeBinaryManager", () => ({
  ...jest.requireActual("./OpencodeBinaryManager"),
  verifyOpencodeBinary: jest.fn().mockResolvedValue({ stdout: "1.18.31" }),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Mock the skills package so we can drive the deny-list synthesis path
// without booting the real jotai store / Obsidian App singleton.
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

// ---------------------------------------------------------------------------
// Registry mocks — `buildOpencodeConfig` only calls
// `backendConfigRegistry.resolveEnabled("opencode")` and
// `providerRegistry.getApiKey(providerId)`.
// ---------------------------------------------------------------------------

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

/** A self-hosted OpenAI-compatible BYOK provider (Ollama / LM Studio / custom). */
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

/** Build an `EnabledBackendEntry` in the `"ok"` state. */
function okEntry(provider: Provider, model: ConfiguredModel): EnabledBackendEntry {
  return {
    configuredModelId: model.configuredModelId,
    state: "ok",
    configuredModel: model,
    provider,
  };
}

/**
 * Construct the registry deps `buildOpencodeConfig` needs from a seeded list
 * of resolved entries and a key map keyed by `providerId`.
 */
function makeDeps(args: {
  resolved: EnabledBackendEntry[];
  keys?: Record<string, string | null>;
  /** Published effort levels keyed by wire id; a missing key answers null. */
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

/** The Copilot Plus provider row `CopilotPlusSetupApi` seeds. */
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

/**
 * A Copilot Plus reasoning model, as the catalog reconcile persists it.
 *
 * @param efforts - Levels the service published for it. Omit for a row whose
 *   levels are unknown, which is what a service too old to publish them leaves
 *   behind.
 */
function makePlusReasoningModel(wireId: string, efforts?: readonly string[]): ConfiguredModel {
  const model = makeModel("p-plus", wireId);
  model.info.reasoning = true;
  if (efforts) model.info.reasoningEfforts = efforts;
  return model;
}

const NO_MODELS_DEPS = makeDeps({ resolved: [] });

describe("buildOpencodeConfig — provider/model injection", () => {
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

  it("registers two distinct providers", async () => {
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

  it("skips a model when the provider has no key in the keychain", async () => {
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

  it("ignores broken resolved entries", async () => {
    const deps = makeDeps({
      resolved: [{ configuredModelId: "gone", state: "broken" }],
    });
    const cfg = await buildOpencodeConfig(getSettings(), deps);
    expect(cfg.providers).toEqual({});
  });

  it("does not inject native (agent-origin) providers — opencode hosts them", async () => {
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

  it("skips unroutable providers (BYOK without a catalog id, e.g. google)", async () => {
    const provider = makeProvider("p-google", { kind: "byok" }, { providerType: "google" });
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-google", "gemini-3-flash"))],
      keys: { "p-google": "google-key" },
    });
    const cfg = await buildOpencodeConfig(getSettings(), deps);
    expect(cfg.providers).toEqual({});
  });

  it("registers a key-less OpenAI-compatible BYOK provider (Ollama) under its providerId", async () => {
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
    // Key-less: apiKey must be absent, not an empty string.
    expect(entry.settings?.apiKey).toBeUndefined();
    expect(entry.models).toEqual({
      "llama3.2": {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
      },
    });
  });

  it("includes apiKey for an OpenAI-compatible BYOK provider that has one", async () => {
    const provider = makeOpenAICompatibleProvider("p-custom", "https://my-endpoint/v1", "Custom");
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-custom", "gpt-5.5"))],
      keys: { "p-custom": "secret-key" },
    });
    const cfg = await buildOpencodeConfig(getSettings(), deps);
    expect(cfg.providers["p-custom"].settings?.apiKey).toBe("secret-key");
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

  it("drops a key-less OpenAI-compatible BYOK provider when its persisted contract requires a key", async () => {
    const provider = makeOpenAICompatibleProvider("p-public", "https://my-proxy.example.com/v1");
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-public", "gpt-5.5"))],
      keys: { "p-public": null },
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
    // Guards the catalog-growth scenario: if a local runner like Ollama ever
    // gains a models.dev entry, its localhost baseUrl still tolerates a missing
    // key, so it must not be dropped.
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
    // Regression: `apiKey ?? undefined` would preserve `""` and leak
    // `Authorization: Bearer ` downstream — assert the field is absent.
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

  it("passes a baseUrl override through for a catalog provider (no npm — opencode resolves the SDK natively)", async () => {
    // A catalog provider keeps native resolution (no npm), but when the user
    // overrides its baseUrl we must forward it so opencode routes to the proxy
    // instead of the registry default — matching the chat backend's behavior.
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

  it("omits the baseURL when a catalog provider's URL is its own host-only endpoint (Google dialog seed)", async () => {
    // The dialog seeds Google with the host-only endpoint, but the AI SDK
    // treats baseURL as the complete prefix — forwarding it would drop the
    // `/v1beta` segment and 404 every call. Recognize the canonical endpoint
    // and let opencode's registry default (the versioned form) apply.
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

  it("omits the baseURL when a catalog provider's URL is its versioned endpoint (Groq models.dev seed)", async () => {
    const provider = makeProvider(
      "p-groq",
      { kind: "byok", catalogProviderId: "groq" },
      { providerType: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1" }
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-groq", "llama-3.3-70b-versatile"))],
      keys: { "p-groq": "gq-123" },
    });
    const cfg = await buildOpencodeConfig(getSettings(), deps);
    expect(cfg.providers.groq.settings).toEqual({ apiKey: "gq-123" });
  });

  it("registers Copilot Plus as a custom openai-compatible provider from its own fields", async () => {
    // Plus has no catalog identity, so its route comes from the provider row.
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
      resolved: [okEntry(makePlusProvider(), makePlusReasoningModel("glm-5.2", ["none", "high"]))],
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
    // A row cached before the service published levels, or one reconciled from a
    // response that could not be read. Either way an imperfect menu beats
    // dropping a control that works.
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
    // Only Copilot Plus publishes levels. A BYOK row that happens to carry them
    // must still keep opencode's own inference, since nothing vouches for them.
    const provider = makeProvider("p-anthropic", { kind: "byok", catalogProviderId: "anthropic" });
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
});

/** The top-level rule every generated config carries. */
const QUESTION_DENY = { action: "question", resource: "*", effect: "deny" };

/** `copilot-build`'s ask-before-write rules. */
const ASK_BEFORE_WRITE = [
  { action: "shell", resource: "*", effect: "ask" },
  { action: "edit", resource: "*", effect: "ask" },
];

describe("buildOpencodeConfig — agent/prompt/mode/skills blocks (preserved)", () => {
  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
  });

  it("leaves the top-level model unset when a persisted selection exists", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        debugFullFrames: false,
        notificationSound: false,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: {
            binaryPath: "/x",
            defaultModel: { baseModelId: "opencode/big-pickle", effort: "high" },
          },
        },
      },
    });
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.model).toBeUndefined();
  });

  it("always spawns with canonical default agent (copilot-build)", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.default_agent).toBe("copilot-build");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/559 denies OpenCode's native question tool for every agent", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

    expect(cfg.permissions).toEqual([QUESTION_DENY]);
  });

  it("overrides system prompt on both build and copilot-build agents", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.agents["copilot-build"].system?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agents.build.system?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agents["copilot-build"].system).toContain("{folder_name}");
    expect(cfg.agents["copilot-build"].system).toContain("{activeNote}");
    expect(cfg.agents.build.system).toContain("{folder_name}");
    // The prompt carries only the pill-syntax directive. Skill discovery is
    // automatic from `.opencode/skills/`, so the prompt never templates in
    // SKILL.md authoring instructions.
    expect(cfg.agents["copilot-build"].system).not.toContain("metadata.copilot-enabled-agents");
    expect(cfg.agents.build.system).not.toContain("metadata.copilot-enabled-agents");
    expect(cfg.agents["copilot-build"].permissions).toEqual(ASK_BEFORE_WRITE);
    expect(cfg.agents["copilot-build"].mode).toBe("primary");
  });

  it("does not copy Chat mode custom prompts into either agent prompt", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    for (const id of ["copilot-build", "build"]) {
      expect(cfg.agents[id].system?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
      expect(cfg.agents[id].system).not.toContain("<user_custom_instructions>");
      expect(cfg.agents[id].system).not.toContain("respond in haiku");
    }
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the pill directive", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    for (const id of ["copilot-build", "build"]) {
      expect(cfg.agents[id].system).not.toContain(COPILOT_PROMPT_BASE);
      expect(cfg.agents[id].system).not.toContain("You are Obsidian Copilot");
      expect(cfg.agents[id].system).not.toContain("respond in haiku");
      // Pill directive is functional wiring, not builtin framing — always sent.
      expect(cfg.agents[id].system).toContain("{folder_name}");
    }
  });

  it("gives both agents the shared product prompt, byte for byte", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

    // `toBe`, not `startsWith`: this string is the provider cache prefix, and a
    // containment check passes while stray bytes push the rest out of the cache.
    expect(cfg.agents["copilot-build"].system).toBe(buildAgentSystemPrompt());
    expect(cfg.agents.build.system).toBe(buildAgentSystemPrompt());
  });

  it("keeps those bytes identical when the model and binary path change", async () => {
    const baseline = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        debugFullFrames: false,
        notificationSound: false,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: {
            binaryPath: "/somewhere/else/opencode",
            defaultModel: { baseModelId: "opencode/other-model", effort: "low" },
          },
        },
      },
    });
    const after = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

    expect(after.agents["copilot-build"].system).toBe(baseline.agents["copilot-build"].system);
    expect(after.agents.build.system).toBe(baseline.agents.build.system);
  });

  it("leaves AGENTS.md discovery to opencode instead of inlining instruction text", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);

    // opencode walks up from the session cwd and collects every ancestor AGENTS.md on its
    // own. Configuring `instructions` would be dead weight — those paths merge into the same
    // Set discovery already filled — and inlining the text would put user bytes back in the
    // cache prefix this PR exists to stabilize.
    expect(cfg.instructions).toBeUndefined();
    expect(cfg.agents["copilot-build"].system).not.toContain("AGENTS.md instructions:");
  });

  it("does not template a skills folder into the opencode prompts", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        debugFullFrames: false,
        notificationSound: false,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        skills: { folder: "team-skills" },
        backends: {},
      },
    });
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    // The pill directive doesn't reference the skills folder at all.
    expect(cfg.agents["copilot-build"].system).not.toContain("team-skills");
    expect(cfg.agents.build.system).not.toContain("team-skills");
  });

  it("denies a skill enabled for Claude only (cross-discovered, not enabled for opencode)", async () => {
    seedSkills([makeSkill("foo", ["claude"])]);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.permissions).toEqual([
      QUESTION_DENY,
      { action: "skill", resource: "foo", effect: "deny" },
    ]);
  });

  it("does not deny a skill enabled for both Claude and OpenCode", async () => {
    seedSkills([makeSkill("foo", ["claude", "opencode"])]);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.permissions).toEqual([QUESTION_DENY]);
  });

  it("adds no skill deny rules when no skills need denying", async () => {
    seedSkills([makeSkill("foo", ["opencode"])]);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.permissions).toEqual([QUESTION_DENY]);
  });

  it("adds no skill deny rules when there are no skills at all", async () => {
    seedSkills([]);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.permissions).toEqual([QUESTION_DENY]);
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

  it("synthesises deny rules for a mix of skills (only cross-discovered + not-enabled wins)", async () => {
    seedSkills([
      makeSkill("a", ["claude"]),
      makeSkill("b", ["claude", "opencode"]),
      makeSkill("c", []),
      makeSkill("d", ["opencode"]),
      makeSkill("e", ["codex"]),
    ]);
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    // a is claude-only → denied. e is codex-only → denied (codex also
    // populates the cross-discovered `.agents/skills/` path). b/c/d not denied.
    expect(cfg.permissions).toEqual([
      QUESTION_DENY,
      { action: "skill", resource: "a", effect: "deny" },
      { action: "skill", resource: "e", effect: "deny" },
    ]);
  });

  it("skips deny synthesis when SkillManager has not initialised yet", async () => {
    mockSkills = [makeSkill("foo", ["claude"])];
    mockSkillManagerReady = false;
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.permissions).toEqual([QUESTION_DENY]);
  });
});

describe("buildOpencodeConfig — context-cache external_directory allow", () => {
  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
  });

  it("injects a cacheRoot-scoped external_directory allow on both spawn agents", async () => {
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
    // build (auto) gets only the external_directory grant — no shell/edit asks.
    expect(cfg.agents.build.permissions).toEqual([allow]);
    // copilot-build (default) keeps its ask-before-write rules AND gains allow.
    expect(cfg.agents["copilot-build"].permissions).toEqual([...ASK_BEFORE_WRITE, allow]);
  });

  it("injects nothing when no cacheRoot is provided (feature dormant)", async () => {
    const cfg = await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS);
    expect(cfg.agents.build.permissions).toBeUndefined();
    expect(cfg.agents["copilot-build"].permissions).toEqual(ASK_BEFORE_WRITE);
  });
});

describe("OpencodeBackend.buildSpawnDescriptor", () => {
  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/535 rejects the actual old executable even when settings claim a supported version", async () => {
    updateAgentModeBackendFields("opencode", {
      binaryPath: "/old-opencode",
      binaryVersion: "2.0.0",
      binarySource: "managed",
    });
    jest.mocked(verifyOpencodeBinary).mockResolvedValueOnce({ stdout: "1.0.0" });
    await expect(
      new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow("1.0.0");
    expect(verifyOpencodeBinary).toHaveBeenCalledWith("/old-opencode");
  });

  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
    (logWarn as jest.Mock).mockClear();
  });

  it("throws if no binary is installed", async () => {
    const backend = new OpencodeBackend(NO_MODELS_DEPS);
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /binary not installed/
    );
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/555 launches ACP in the vault without the removed --cwd argument and injects enabled models", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          binaryVersion: "1.3.17",
          binarySource: "managed",
        },
      },
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
    expect(desc.env.OPENCODE_LOG_LEVEL).toBe("WARN");
    expect(desc.cwd).toBe("/vault/abs");
    expect(desc.env[OPENARTIFACTS_WORKSPACE_ROOT_ENV]).toBe("/vault/abs");
    expect(desc.env.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    expect(cfg.providers.anthropic.settings).toEqual({ apiKey: "anth-xyz" });
    expect(cfg.providers.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 lets a user opt into more detailed OpenCode logs", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_LOG_LEVEL: "DEBUG" },
        },
      },
    });

    const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
      vaultBasePath: "/vault",
    });

    expect(desc.args).toEqual(["acp", "--print-logs"]);
    expect(desc.env.OPENCODE_LOG_LEVEL).toBe("DEBUG");
  });

  it("passes the plugin version to built-in Copilot Plus skills", async () => {
    setSettings({ isPaidUser: true, plusLicenseKey: "plus-token", userId: "user-1" });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: { opencode: { binaryPath: "/path/to/opencode" } },
    });
    const backend = new OpencodeBackend({
      ...NO_MODELS_DEPS,
      clientVersion: "4.0.0-preview-260802",
    });

    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });

    expect(desc.env.COPILOT_CLIENT_VERSION).toBe("4.0.0-preview-260802");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 gives global and Project sessions the same protected active-vault Miyo identity", async () => {
    setSettings({ miyoSearchAll: false });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: {
            [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
            [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
          },
        },
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

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/558 denies native web tools last in every legacy and native permission override in Self-Host Mode", async () => {
    setSettings({ enableSelfHostMode: true });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: {
            [SELF_HOST_WEB_SEARCH_ENV]: "",
            [SELF_HOST_WEB_SEARCH_URL_ENV]: "http://attacker.invalid",
            [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "replacement-token",
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              permission: { websearch: "allow" },
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "websearch", resource: "*", effect: "allow" },
              ],
              agent: {
                build: { permission: { bash: "ask", websearch: "allow" } },
              },
              agents: {
                build: {
                  permissions: [{ action: "webfetch", resource: "*", effect: "allow" }],
                },
                custom: { permissions: [{ action: "*", resource: "*", effect: "allow" }] },
                empty: { description: "No rule yet" },
              },
            }),
          },
        },
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
    expect(cfg.permission).toEqual({ websearch: "deny", webfetch: "deny" });
    expect(cfg.agent.build.permission).toEqual({
      bash: "ask",
      websearch: "deny",
      webfetch: "deny",
    });
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/558 moves a legacy web allow behind the override's later wildcard so the web deny still matches last", async () => {
    setSettings({ enableSelfHostMode: true });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              agent: { research: { permission: { websearch: "allow", "*": "allow" } } },
            }),
          },
        },
      },
    });

    const desc = await new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({
      vaultBasePath: "/active-vault",
      vaultName: "active-vault",
    });
    const cfg = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);

    // OpenCode 2 converts legacy permission keys to rules in key order and
    // applies the last match, so the denies must follow the wildcard allow.
    expect(Object.entries(cfg.agent.research.permission)).toEqual([
      ["*", "allow"],
      ["websearch", "deny"],
      ["webfetch", "deny"],
    ]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 refuses to start Self-Host OpenCode before the replacement search channel is available", async () => {
    setSettings({ enableSelfHostMode: true });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: { opencode: { binaryPath: "/path/to/opencode" } },
    });
    const deps = makeDeps({ resolved: [] });
    delete deps.getSelfHostWebSearchChannel;

    await expect(
      new OpencodeBackend(deps).buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow("self-host web search channel is unavailable");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects a non-object config override instead of starting without native web denies", async () => {
    setSettings({ enableSelfHostMode: true });
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "[]" },
        },
      },
    });

    await expect(
      new OpencodeBackend(NO_MODELS_DEPS).buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow("OPENCODE_CONFIG_CONTENT must be a JSON object");
  });

  it("threads the injected getCacheRoot into the spawned external_directory allow", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: { opencode: { binaryPath: "/path/to/opencode" } },
    });
    const deps: OpencodeModelDeps = {
      ...NO_MODELS_DEPS,
      getCacheRoot: () => "/cache/root",
    };
    const backend = new OpencodeBackend(deps);
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    const allow = { action: "external_directory", resource: "/cache/root/**", effect: "allow" };
    expect(cfg.agents.build.permissions).toEqual([allow]);
    expect(cfg.agents["copilot-build"].permissions).toEqual([...ASK_BEFORE_WRITE, allow]);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("warns when an OPENCODE_CONFIG_CONTENT override would drop the cache allow rule", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "{}" },
        },
      },
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

  it("treats a blank getCacheRoot result as unavailable (no allow rule, no warn)", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: { opencode: { binaryPath: "/path/to/opencode" } },
    });
    const deps: OpencodeModelDeps = {
      ...NO_MODELS_DEPS,
      getCacheRoot: () => "   ",
    };
    const backend = new OpencodeBackend(deps);
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    const cfg: GeneratedOpencodeConfig = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    expect(cfg.agents.build.permissions).toBeUndefined();
    expect(cfg.agents["copilot-build"].permissions).toEqual(ASK_BEFORE_WRITE);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("skips building the generated config when an override replaces it (https://github.com/logancyang/obsidian-copilot/issues/2917)", async () => {
    // The override wins wholesale, so building a config would only be work
    // thrown away.
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: '{"model":"custom"}' },
        },
      },
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

  it("does not warn about the override when no cacheRoot is resolved", async () => {
    updateSetting("agentMode", {
      byok: {},
      activeBackend: "opencode",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          envOverrides: { OPENCODE_CONFIG_CONTENT: "{}" },
        },
      },
    });
    const backend = new OpencodeBackend(NO_MODELS_DEPS);
    await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    expect(logWarn).not.toHaveBeenCalled();
  });
});

// `COPILOT_PROMPT_BASE` and the full `buildAgentSystemPrompt` composition are
// unit-tested in `backends/shared/agentSystemPrompt.test.ts`. The opencode tests
// above only assert that the composed prompt reaches `cfg.agents.<id>.system`.

describe("OPENCODE_PROVIDER_MAP", () => {
  it("maps the BYOK provider ids plus Copilot Plus to opencode provider ids", () => {
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.ANTHROPIC]).toBe("anthropic");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.OPENAI]).toBe("openai");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.OPENROUTERAI]).toBe("openrouter");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.COPILOT_PLUS]).toBe("copilot-plus");
  });
});
