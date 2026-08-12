import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";

import ChatModelManager from "./chatModelManager";

jest.mock("@langchain/anthropic", () => ({ ChatAnthropic: class {} }));
// Capture constructor configs so tests can assert what the manager actually
// hands the LangChain clients (e.g. base-URL normalization).
jest.mock("@langchain/groq", () => {
  class ChatGroq {
    static configs: unknown[] = [];
    constructor(config: unknown) {
      ChatGroq.configs.push(config);
    }
  }
  return { ChatGroq };
});
jest.mock("@langchain/google-genai", () => {
  class ChatGoogleGenerativeAI {
    static configs: unknown[] = [];
    constructor(config: unknown) {
      ChatGoogleGenerativeAI.configs.push(config);
    }
  }
  return { ChatGoogleGenerativeAI };
});
jest.mock("./ChatOpenRouter", () => {
  class ChatOpenRouter {
    static configs: unknown[] = [];
    constructor(config: unknown) {
      ChatOpenRouter.configs.push(config);
    }
  }
  return { ChatOpenRouter };
});

import { BrevilabsClient } from "./brevilabsClient";

function bridgedModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4o-mini",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    ...overrides,
  };
}

describe("ChatModelManager bridged models", () => {
  const originalOpenAiKey = getSettings().openAIApiKey;

  afterEach(() => {
    setSettings({ openAIApiKey: originalOpenAiKey });
  });

  it("does not fall back to a legacy top-level provider key", async () => {
    setSettings({ openAIApiKey: "legacy-key" });

    await expect(
      ChatModelManager.getInstance().createModelInstanceFromBridged(bridgedModel())
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("findModelByName falls back to the active bridged model so its capabilities resolve", async () => {
    const manager = ChatModelManager.getInstance();
    // A vision-capable Plus model that exists only as a bridged ConfiguredModel
    // (not in legacy activeModels) — e.g. kimi-k2.7-code.
    const model = bridgedModel({
      name: "kimi-k2.7-code",
      provider: ChatModelProviders.COPILOT_PLUS,
      apiKey: "bridge-key",
      capabilities: [ModelCapability.VISION],
    });

    // Not findable before it's the active bridged model...
    expect(manager.findModelByName("kimi-k2.7-code")).toBeUndefined();

    await manager.setChatModelFromBridged(model);

    // ...now resolvable by name, carrying its VISION capability so
    // isMultimodalModel/hasCapability route images instead of dropping them.
    const found = manager.findModelByName("kimi-k2.7-code");
    expect(found).toBe(model);
    expect(found?.capabilities).toContain(ModelCapability.VISION);

    // A different name never resolves to the active bridged model.
    expect(manager.findModelByName("some-other-model")).toBeUndefined();
  });

  it("prefers the active bridged model over a legacy duplicate of the same id", async () => {
    const manager = ChatModelManager.getInstance();
    // copilot-plus-flash exists in legacy activeModels (built-in) advertising only
    // VISION, AND as a bridged model now also carrying REASONING. The bridged one
    // is what's running, so it must win — otherwise hasCapability(REASONING) reads
    // the legacy entry and reasoning content is dropped.
    const legacyFlash = {
      name: "copilot-plus-flash",
      provider: ChatModelProviders.COPILOT_PLUS,
      enabled: true,
      capabilities: [ModelCapability.VISION],
    };
    setSettings({ activeModels: [legacyFlash] });

    const bridged = bridgedModel({
      name: "copilot-plus-flash",
      provider: ChatModelProviders.COPILOT_PLUS,
      apiKey: "bridge-key",
      capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
    });
    await manager.setChatModelFromBridged(bridged);

    const found = manager.findModelByName("copilot-plus-flash");
    expect(found).toBe(bridged);
    expect(found?.capabilities).toEqual(
      expect.arrayContaining([ModelCapability.VISION, ModelCapability.REASONING])
    );

    setSettings({ activeModels: [] });
  });

  it("sends the plugin version with Copilot Plus chat requests", async () => {
    const OpenRouterMock = jest.requireMock("./ChatOpenRouter").ChatOpenRouter as {
      configs: Array<{ configuration?: { defaultHeaders?: Record<string, string> } }>;
    };
    BrevilabsClient.getInstance().setPluginVersion("4.0.0-preview-260802");

    await ChatModelManager.getInstance().createModelInstanceFromBridged(
      bridgedModel({ provider: ChatModelProviders.COPILOT_PLUS, apiKey: "bridge-key" })
    );

    expect(OpenRouterMock.configs.at(-1)?.configuration?.defaultHeaders).toEqual({
      "X-Client-Version": "4.0.0-preview-260802",
    });
  });

  it("retains the active bridged model for temperature overrides", async () => {
    const manager = ChatModelManager.getInstance();
    const model = bridgedModel({ apiKey: "bridge-key" });

    await manager.setChatModelFromBridged(model);

    expect(manager.getActiveModel()).toBe(model);
    await expect(manager.getChatModelWithTemperature(0)).resolves.toBeDefined();
  });

  it("strips a versioned Google base URL — ChatGoogleGenerativeAI appends /v1beta itself", async () => {
    const GoogleMock = jest.requireMock("@langchain/google-genai").ChatGoogleGenerativeAI as {
      configs: Array<{ baseUrl?: string }>;
    };
    const model = bridgedModel({
      name: "gemini-2.5-flash",
      provider: ChatModelProviders.GOOGLE,
      apiKey: "g-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    });

    await ChatModelManager.getInstance().createModelInstanceFromBridged(model);

    expect(GoogleMock.configs.at(-1)?.baseUrl).toBe("https://generativelanguage.googleapis.com");
  });

  it("strips a versioned Groq base URL — groq-sdk appends /openai/v1 itself", async () => {
    const GroqMock = jest.requireMock("@langchain/groq").ChatGroq as {
      configs: Array<{ baseUrl?: string }>;
    };
    const model = bridgedModel({
      name: "llama-3.3-70b-versatile",
      provider: ChatModelProviders.GROQ,
      apiKey: "gq-key",
      baseUrl: "https://api.groq.com/openai/v1",
    });

    await ChatModelManager.getInstance().createModelInstanceFromBridged(model);

    expect(GroqMock.configs.at(-1)?.baseUrl).toBe("https://api.groq.com");
  });
});
