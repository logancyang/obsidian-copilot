import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import type { Provider } from "@/modelManagement";
import { planLegacyOllamaBaseUrlRepair } from "./legacyOllamaBaseUrlMigration";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "ollama",
    providerType: "openai-compatible",
    displayName: "Ollama",
    baseUrl: "http://localhost:11434",
    origin: { kind: "byok" },
    requiresApiKey: false,
    addedAt: 0,
    ...overrides,
  };
}

function legacyOllama(baseUrl: string | undefined): CustomModel {
  return { name: "llama3.2", provider: ChatModelProviders.OLLAMA, baseUrl, enabled: true };
}

describe("legacyOllamaBaseUrlMigration", () => {
  describe("planLegacyOllamaBaseUrlRepair()", () => {
    it("points a provider migrated from a Copilot 3 Ollama model at Ollama's OpenAI-compatible /v1 endpoint (https://github.com/logancyang/obsidian-copilot/issues/4109)", () => {
      const next = planLegacyOllamaBaseUrlRepair({
        activeModels: [legacyOllama("http://localhost:11434/")],
        providers: { ollama: provider({ baseUrl: "http://localhost:11434/" }) },
      });

      expect(next?.ollama).toEqual(provider({ baseUrl: "http://localhost:11434/v1" }));
    });

    it("leaves providers alone that already use /v1, use another URL, or are not custom OpenAI-compatible rows", () => {
      const providers = {
        versioned: provider({ providerId: "versioned", baseUrl: "http://localhost:11434/v1" }),
        other: provider({ providerId: "other", baseUrl: "http://other-host:8080" }),
        catalog: provider({
          providerId: "catalog",
          origin: { kind: "byok", catalogProviderId: "openai" },
        }),
        agent: provider({ providerId: "agent", origin: { kind: "agent", agentType: "opencode" } }),
      };

      const next = planLegacyOllamaBaseUrlRepair({
        activeModels: [legacyOllama("http://localhost:11434"), legacyOllama("http://other-x")],
        providers,
      });

      expect(next).toBeNull();
    });

    it("returns null when no Copilot 3 Ollama model carried a base URL", () => {
      const providers = { ollama: provider() };

      expect(
        planLegacyOllamaBaseUrlRepair({ activeModels: [legacyOllama(undefined)], providers })
      ).toBeNull();
      expect(planLegacyOllamaBaseUrlRepair({ activeModels: [], providers })).toBeNull();
    });
  });
});
