import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";

import ChatModelManager from "./chatModelManager";

jest.mock("@langchain/anthropic", () => {
  class ChatAnthropic {
    static configs: unknown[] = [];
    constructor(config: unknown) {
      ChatAnthropic.configs.push(config);
    }
  }
  return { ChatAnthropic };
});
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

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    const originalOpenAiKey = getSettings().openAIApiKey;

    afterEach(() => {
      setSettings({ openAIApiKey: originalOpenAiKey });
    });

    describe("createModelInstanceFromBridged()", () => {
      it("does not fall back to a legacy top-level provider key", async () => {
        setSettings({ openAIApiKey: "legacy-key" });

        await expect(
          ChatModelManager.getInstance().createModelInstanceFromBridged(bridgedModel())
        ).rejects.toBeInstanceOf(MissingApiKeyError);
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

      it("does not add a browser-only flag as an OpenAI-compatible request header", async () => {
        const model = await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            provider: ChatModelProviders.OPENAI_FORMAT,
            apiKey: "default-key",
            baseUrl: "http://localhost:11434/v1",
          })
        );
        const clientConfig = (
          model as unknown as {
            clientConfig: {
              dangerouslyAllowBrowser?: boolean;
              defaultHeaders?: Record<string, string>;
            };
          }
        ).clientConfig;

        expect(clientConfig.dangerouslyAllowBrowser).toBe(true);
        expect(clientConfig.defaultHeaders?.["dangerously-allow-browser"]).toBeUndefined();
      });

      it("omits Authorization for a keyless bridged OpenAI-compatible model (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
        const model = await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            provider: ChatModelProviders.OPENAI_FORMAT,
            baseUrl: "http://127.0.0.1:8000/v1",
            requiresApiKey: false,
          })
        );
        const clientConfig = (
          model as unknown as {
            clientConfig: {
              apiKey?: string;
              defaultHeaders?: Record<string, string | null>;
            };
          }
        ).clientConfig;

        expect(clientConfig.apiKey).toBeUndefined();
        expect(clientConfig.defaultHeaders?.Authorization).toBeNull();
      });

      it("strips a versioned Google base URL because the client appends /v1beta itself", async () => {
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

        expect(GoogleMock.configs.at(-1)?.baseUrl).toBe(
          "https://generativelanguage.googleapis.com"
        );
      });

      it("sends no output cap for a model that carries no limit of its own (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const GroqMock = jest.requireMock("@langchain/groq").ChatGroq as {
          configs: Array<Record<string, unknown>>;
        };

        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            name: "llama-3.3-70b-versatile",
            provider: ChatModelProviders.GROQ,
            apiKey: "gq-key",
          })
        );

        expect("maxTokens" in (GroqMock.configs.at(-1) ?? {})).toBe(false);
      });

      it("honors an explicit per-model output limit when one is set (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const GroqMock = jest.requireMock("@langchain/groq").ChatGroq as {
          configs: Array<{ maxTokens?: number }>;
        };

        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            name: "llama-3.3-70b-versatile",
            provider: ChatModelProviders.GROQ,
            apiKey: "gq-key",
            maxTokens: 8192,
          })
        );

        expect(GroqMock.configs.at(-1)?.maxTokens).toBe(8192);
      });

      it("leaves an Anthropic model with no resolved ceiling to the client's own per-model default (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const AnthropicMock = jest.requireMock("@langchain/anthropic").ChatAnthropic as {
          configs: Array<{ maxTokens?: number }>;
        };

        // The client knows each Claude's real maximum. Forcing one value across
        // all of them asks older models for more than they accept.
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            apiKey: "sk-ant",
          })
        );

        expect(AnthropicMock.configs.at(-1)?.maxTokens).toBeUndefined();
      });

      it("strips a versioned Groq base URL because the client appends /openai/v1 itself", async () => {
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

    describe("findModelByName()", () => {
      it("falls back to the active bridged model so its capabilities resolve", async () => {
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
    });

    describe("getChatModelWithTemperature()", () => {
      it("retains the active bridged model for temperature overrides", async () => {
        const manager = ChatModelManager.getInstance();
        const model = bridgedModel({ apiKey: "bridge-key" });

        await manager.setChatModelFromBridged(model);

        expect(manager.getActiveModel()).toBe(model);
        await expect(manager.getChatModelWithTemperature(0)).resolves.toBeDefined();
      });
    });
  });
});
