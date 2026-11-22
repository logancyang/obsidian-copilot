import { err2String, getProviderLabel } from "@/lib/model-display-utils";
import type { CustomModel } from "@/aiParams";

const model = (overrides: Partial<CustomModel> = {}): CustomModel => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...overrides,
});

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

  describe("err2String()", () => {
    it("exposes the canonical pure error formatter through the lib surface", () => {
      expect(err2String(new Error("boom"))).toBe("boom");
    });
  });
});
