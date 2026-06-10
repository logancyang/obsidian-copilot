import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
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
