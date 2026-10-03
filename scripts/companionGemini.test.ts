import { parseAgyModelsOutput } from "../adapters/companions/gemini-backend";

describe("geminiBackend", () => {
  describe("parseAgyModelsOutput()", () => {
    it("preserves direct JSON effort levels", () => {
      const result = parseAgyModelsOutput(
        JSON.stringify([
          {
            modelId: "gemini-3.7-flash",
            supportsReasoningEffort: true,
            reasoningEfforts: [{ value: "low" }, { value: "high" }],
          },
        ])
      );
      expect(result.availableModels[0]._meta.reasoningEfforts).toEqual([
        { value: "low" },
        { value: "high" },
      ]);
    });
    it("preserves nested JSON effort capabilities", () => {
      const result = parseAgyModelsOutput(
        JSON.stringify([
          {
            modelId: "gemini-3.7-flash",
            _meta: {
              supportsReasoningEffort: true,
              reasoningEfforts: [{ value: "low" }, { value: "high" }],
            },
          },
        ])
      );
      expect(result.availableModels[0]._meta).toMatchObject({
        supportsReasoningEffort: true,
        reasoningEfforts: [{ value: "low" }, { value: "high" }],
      });
    });
    it.each([
      "dynamic-high\tDynamic High\ndynamic\tDynamic\ndynamic-low\tDynamic Low\n",
      "dynamic\tDynamic\ndynamic-low\tDynamic Low\ndynamic-high\tDynamic High\n",
    ])("merges text variants independently of base-entry order: %s", (output) => {
      expect(parseAgyModelsOutput(output).availableModels[0]._meta.reasoningEfforts).toEqual([
        { value: "low" },
        { value: "high" },
      ]);
    });
    it("keeps known fixed-effort text model ids intact", () => {
      expect(
        parseAgyModelsOutput("gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n").availableModels[0]
      ).toMatchObject({
        modelId: "gpt-oss-120b-medium",
        _meta: { supportsReasoningEffort: false },
      });
    });
    it("preserves explicit lack of effort support", () => {
      expect(
        parseAgyModelsOutput('[{"modelId":"plain","supportsReasoningEffort":false}]')
          .availableModels[0]._meta.supportsReasoningEffort
      ).toBe(false);
    });
  });
});
