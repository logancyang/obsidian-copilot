import { Platform } from "obsidian";

import { stripLegacyIndexSettings } from "./legacyIndexSettings";

describe("legacyIndexSettings", () => {
  describe("stripLegacyIndexSettings()", () => {
    it.each([
      { name: "index enabled", enableSemanticSearchV3: true, activeEmbeddingModels: [{}] },
      { name: "index disabled", enableSemanticSearchV3: false, activeEmbeddingModels: [] },
      { name: "no embedding rows", enableSemanticSearchV3: true },
    ])(
      "removes retired fields from a vault with $name (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)",
      ({ name: _name, ...legacyFields }) => {
        const cleaned = stripLegacyIndexSettings({
          keep: "value",
          embeddingModelKey: "embed|openai",
          embeddingRequestsPerMin: 60,
          embeddingBatchSize: 16,
          numPartitions: 2,
          enableIndexSync: true,
          disableIndexOnMobile: true,
          indexVaultToVectorStore: "ON MODE SWITCH",
          openAIEmbeddingProxyBaseUrl: "https://proxy.example",
          azureOpenAIApiEmbeddingDeploymentName: "embed",
          ...legacyFields,
        });

        expect(cleaned).toEqual({ keep: "value" });
      }
    );

    it("preserves shared provider credentials and BYOK rows byte-identically (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", () => {
      const providers = {
        custom: {
          providerId: "custom",
          providerType: "openai-compatible",
          apiKeyKeychainId: "copilot-v12345678-provider-custom",
          extras: { headers: { "X-Custom": "value" } },
        },
      };
      const configuredModels = [
        { configuredModelId: "model-1", providerId: "custom", info: { id: "model-wire" } },
      ];
      const before = JSON.stringify({ providers, configuredModels });

      const cleaned = stripLegacyIndexSettings({
        providers,
        configuredModels,
        openAIApiKey: "shared-chat-key",
        activeEmbeddingModels: [{ apiKey: "retired-embedding-key" }],
      });

      expect(
        JSON.stringify({
          providers: cleaned.providers,
          configuredModels: cleaned.configuredModels,
        })
      ).toBe(before);
      expect(cleaned.openAIApiKey).toBe("shared-chat-key");
    });

    it("does not depend on the platform when stripping synced settings (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", () => {
      const original = Platform.isMobile;
      const raw = { keep: true, enableIndexSync: false, activeEmbeddingModels: [] };
      Platform.isMobile = false;
      const desktop = stripLegacyIndexSettings(raw);
      Platform.isMobile = true;
      const mobile = stripLegacyIndexSettings(raw);
      Platform.isMobile = original;

      expect(mobile).toEqual(desktop);
    });
  });
});
