import { catalogOptions, normalizeCatalogResponse } from "../adapters/companions/catalog";

describe("companionCatalog", () => {
  describe("catalogOptions()", () => {
    it("exposes model selection and the selected model's reasoning levels", () => {
      const options = catalogOptions(
        {
          currentModelId: "grok",
          availableModels: [
            {
              modelId: "grok",
              name: "Grok",
              _meta: { reasoningEfforts: [{ value: "low" }, { value: "high" }] },
            },
          ],
        },
        "high"
      );
      expect(options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "model", currentValue: "grok" }),
          expect.objectContaining({ category: "thought_level", currentValue: "high" }),
        ])
      );
    });
    it("omits effort when the selected model does not advertise it", () => {
      expect(
        catalogOptions({ currentModelId: "plain", availableModels: [{ modelId: "plain" }] })
      ).toHaveLength(1);
    });
    it("uses the Muse session effort vocabulary when explicitly supplied", () => {
      expect(
        catalogOptions({ availableModels: [{ modelId: "muse" }] }, undefined, ["low", "medium"])[1]
          .currentValue
      ).toBe("medium");
    });
  });
  describe("normalizeCatalogResponse()", () => {
    it("makes a metadata model catalog available to Copilot's config-option picker", () => {
      const models = { currentModelId: "muse", availableModels: [{ modelId: "muse" }] };
      const result = normalizeCatalogResponse({ _meta: { models } });
      expect(result).toMatchObject({
        models,
        configOptions: [{ category: "model", currentValue: "muse" }],
      });
    });
    it("preserves non-catalog responses", () => {
      const response = { sessionId: "one" };
      expect(normalizeCatalogResponse(response)).toBe(response);
    });
  });
});
