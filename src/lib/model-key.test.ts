import { getModelKeyFromModel } from "@/lib/model-key";
import type { CustomModel } from "@/aiParams";

const model = (overrides: Partial<CustomModel> = {}): CustomModel => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...overrides,
});

describe("model-key", () => {
  describe("getModelKeyFromModel()", () => {
    it("combines the model name and provider for plugin models", () => {
      expect(getModelKeyFromModel(model())).toBe("gpt-5|openai");
    });

    it("prefixes the backend id for otherwise-colliding agent models", () => {
      expect(getModelKeyFromModel({ ...model({ name: "sonnet" }), _backendId: "claude" })).toBe(
        "claude:sonnet|openai"
      );
    });
  });
});
