import type { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { setSettings } from "@/settings/model";
import { BrevilabsClient } from "./brevilabsClient";
import EmbeddingManager from "./embeddingManager";

describe("embeddingManager", () => {
  describe("EmbeddingManager", () => {
    describe("getEmbeddingConfig()", () => {
      beforeEach(() => {
        setSettings({ plusLicenseKey: "plus-token", embeddingBatchSize: 16 });
        BrevilabsClient.getInstance().setPluginVersion("4.0.0-preview-260802");
      });

      it.each([EmbeddingModelProviders.COPILOT_PLUS, EmbeddingModelProviders.COPILOT_PLUS_JINA])(
        "adds the plugin version to %s requests",
        async (provider) => {
          const model: CustomModel = {
            name: "embedding-model",
            provider,
            enabled: true,
          };

          const manager = Object.create(EmbeddingManager.prototype) as unknown as {
            getEmbeddingConfig(model: CustomModel): Promise<Record<string, unknown>>;
          };
          const config = await manager.getEmbeddingConfig(model);

          expect(config.headers).toEqual({
            "X-Client-Version": "4.0.0-preview-260802",
          });
        }
      );
    });
  });
});
