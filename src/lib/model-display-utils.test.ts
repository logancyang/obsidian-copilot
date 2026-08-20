import { checkModelApiKey, err2String, getProviderLabel } from "@/lib/model-display-utils";
import type { ModelApiKeySettings } from "@/lib/model-display-utils";
import type { CustomModel } from "@/aiParams";

const model = (overrides: Partial<CustomModel> = {}): CustomModel => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...overrides,
});

const settings = (overrides: Partial<ModelApiKeySettings> = {}): Readonly<ModelApiKeySettings> =>
  overrides as ModelApiKeySettings;

describe("model-display-utils", () => {
  describe("getProviderLabel()", () => {
    it("returns known labels, believer suffixes, and unknown provider ids", () => {
      expect(getProviderLabel("openai")).toBe("OpenAI");
      expect(
        getProviderLabel(
          "copilot-plus",
          model({ provider: "copilot-plus", believerExclusive: true })
        )
      ).toBe("Copilot(Believer)");
      expect(getProviderLabel("custom-provider")).toBe("custom-provider");
    });
  });

  describe("checkModelApiKey()", () => {
    it("uses only the passed settings snapshot for a provider key", () => {
      expect(checkModelApiKey(model(), settings({ openAIApiKey: "from-prop" }))).toEqual({
        hasApiKey: true,
      });
      expect(checkModelApiKey(model(), settings())).toEqual({
        hasApiKey: false,
        errorNotice:
          "Please configure API Key for gpt-5 in settings first.\nPath: Settings > Copilot > BYOK",
      });
    });

    it("prefers a model-specific key over an empty settings snapshot", () => {
      expect(checkModelApiKey(model({ apiKey: "model-key" }), settings())).toEqual({
        hasApiKey: true,
      });
    });

    it("does not require keys for local or unknown providers", () => {
      expect(checkModelApiKey(model({ provider: "ollama" }), settings())).toEqual({
        hasApiKey: true,
      });
      expect(checkModelApiKey(model({ provider: "custom-provider" }), settings())).toEqual({
        hasApiKey: true,
      });
    });
  });

  describe("err2String()", () => {
    it("exposes the canonical pure error formatter through the lib surface", () => {
      expect(err2String(new Error("boom"))).toBe("boom");
    });
  });
});
