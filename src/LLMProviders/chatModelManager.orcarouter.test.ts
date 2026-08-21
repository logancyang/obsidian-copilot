import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability, ProviderInfo } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";

import ChatModelManager from "./chatModelManager";

// Capture constructor configs so tests can assert what the manager actually
// hands the LangChain `ChatOpenAI` client for the OrcaRouter provider.
jest.mock("@langchain/openai", () => {
  class ChatOpenAI {
    static configs: unknown[] = [];
    constructor(config: unknown) {
      ChatOpenAI.configs.push(config);
    }
  }
  return { ChatOpenAI };
});
// The manager imports every LangChain provider constructor at module load;
// mock the rest so the module graph loads without resolving real classes.
jest.mock("@langchain/anthropic", () => {
  return { ChatAnthropic: class {} };
});
jest.mock("@langchain/deepseek", () => {
  return { ChatDeepSeek: class {} };
});
jest.mock("@langchain/groq", () => {
  return { ChatGroq: class {} };
});
jest.mock("@langchain/google-genai", () => {
  return { ChatGoogleGenerativeAI: class {} };
});
jest.mock("@langchain/ollama", () => {
  return { ChatOllama: class {} };
});
jest.mock("@langchain/xai", () => {
  return { ChatXAI: class {} };
});
jest.mock("./ChatOpenRouter", () => {
  return { ChatOpenRouter: class {} };
});
jest.mock("./ChatLMStudio", () => {
  return { ChatLMStudio: class {} };
});

function orcaRouterModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "orcarouter/auto",
    provider: ChatModelProviders.ORCAROUTER,
    enabled: true,
    ...overrides,
  };
}

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    const originalKey = getSettings().orcarouterApiKey;

    afterEach(() => {
      setSettings({ orcarouterApiKey: originalKey });
      // Clear captured constructor configs between cases.
      (jest.requireMock("@langchain/openai").ChatOpenAI as { configs: unknown[] }).configs = [];
    });

    describe("OrcaRouter provider", () => {
      it("routes OrcaRouter models through ChatOpenAI with the OrcaRouter base URL", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          orcaRouterModel({ apiKey: "sk-orca-test" })
        );

        const OpenAI = jest.requireMock("@langchain/openai").ChatOpenAI as {
          configs: Array<{ modelName: string; configuration?: { baseURL?: string } }>;
        };
        const config = OpenAI.configs[OpenAI.configs.length - 1];
        expect(config.modelName).toBe("orcarouter/auto");
        expect(config.configuration?.baseURL).toBe(
          ProviderInfo[ChatModelProviders.ORCAROUTER].host
        );
      });

      it("uses the default OrcaRouter base URL when the model has no custom baseUrl", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          orcaRouterModel({ apiKey: "sk-orca-test" })
        );

        const OpenAI = jest.requireMock("@langchain/openai").ChatOpenAI as {
          configs: Array<{ configuration?: { baseURL?: string } }>;
        };
        const config = OpenAI.configs[OpenAI.configs.length - 1];
        expect(config.configuration?.baseURL).toBe("https://api.orcarouter.ai/v1");
      });

      it("honors a per-model custom baseUrl override", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          orcaRouterModel({ apiKey: "sk-orca-test", baseUrl: "https://proxy.example.com/v1" })
        );

        const OpenAI = jest.requireMock("@langchain/openai").ChatOpenAI as {
          configs: Array<{ configuration?: { baseURL?: string } }>;
        };
        const config = OpenAI.configs[OpenAI.configs.length - 1];
        expect(config.configuration?.baseURL).toBe("https://proxy.example.com/v1");
      });

      it("throws MissingApiKeyError when the model carries no OrcaRouter key", async () => {
        await expect(
          ChatModelManager.getInstance().createModelInstanceFromBridged(orcaRouterModel())
        ).rejects.toBeInstanceOf(MissingApiKeyError);
      });

      it("resolves capability flags for the built-in reasoning-capable auto model", () => {
        const model = orcaRouterModel({
          capabilities: [ModelCapability.REASONING],
        });
        expect(model.capabilities).toContain(ModelCapability.REASONING);
      });
    });
  });
});
