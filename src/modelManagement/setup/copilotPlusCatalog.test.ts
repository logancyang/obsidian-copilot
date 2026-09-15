import type { BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import {
  parseContextLength,
  readCopilotPlusCatalog,
} from "@/modelManagement/setup/copilotPlusCatalog";

describe("copilotPlusCatalog", () => {
  describe("parseContextLength()", () => {
    it.each([
      ["1M", 1024 * 1024],
      ["256K", 256 * 1024],
      ["192K", 192 * 1024],
      ["8192", 8192],
      ["  1m  ", 1024 * 1024],
      ["1.5M", Math.round(1.5 * 1024 * 1024)],
    ])("reads %s as %d tokens", (display, tokens) => {
      expect(parseContextLength(display)).toBe(tokens);
    });

    it.each([[undefined], [null], [""], ["unlimited"], ["1G"], ["0"], ["-5K"], [1024]])(
      "rejects %p rather than guessing a window",
      (display) => {
        expect(parseContextLength(display)).toBeNull();
      }
    );
  });

  describe("readCopilotPlusCatalog()", () => {
    it("maps every published field onto the model row", () => {
      const catalog = readCopilotPlusCatalog({
        data: [
          {
            id: "glm-5.2",
            label: "GLM-5.2",
            description: "A frontier open-weight model.",
            context_length: "256K",
            supports_images: true,
            supports_tools: true,
            supports_reasoning: true,
            reasoning_efforts: ["none", "high"],
            default_enabled: true,
          },
        ],
      });

      expect(catalog).toEqual({
        models: [
          {
            id: "glm-5.2",
            displayName: "GLM-5.2",
            description: "A frontier open-weight model.",
            toolCall: true,
            reasoning: true,
            reasoningEfforts: ["none", "high"],
            modalities: { input: ["text", "image"], output: ["text"] },
            limits: { context: 256 * 1024 },
          },
        ],
        defaultEnabledIds: ["glm-5.2"],
      });
    });

    it("keeps a model that reasons with no selectable level distinct from one whose levels are unknown", () => {
      // An empty list means the model honors no level and should get no effort
      // control; an absent one means we do not know, and the consumer keeps
      // whatever menu it would infer. Collapsing them removes a working control.
      const catalog = readCopilotPlusCatalog({
        data: [
          { id: "no-levels", supports_reasoning: true, reasoning_efforts: [] },
          { id: "unknown-levels", supports_reasoning: true },
        ],
      });

      expect(catalog!.models[0].reasoningEfforts).toEqual([]);
      expect(catalog!.models[1].reasoningEfforts).toBeUndefined();
    });

    it("treats a list of unusable levels as unknown rather than as no levels", () => {
      const catalog = readCopilotPlusCatalog({
        data: [{ id: "garbage-levels", reasoning_efforts: ["", "   ", 7] as string[] }],
      });

      expect(catalog!.models[0].reasoningEfforts).toBeUndefined();
    });

    it("falls back to the id when the service publishes no label", () => {
      const catalog = readCopilotPlusCatalog({ data: [{ id: "unlabeled" }] });

      expect(catalog!.models[0].displayName).toBe("unlabeled");
    });

    it("omits capability fields the service did not publish rather than defaulting them", () => {
      const catalog = readCopilotPlusCatalog({ data: [{ id: "bare", label: "Bare" }] });

      expect(catalog!.models[0]).toEqual({ id: "bare", displayName: "Bare" });
    });

    it("reports only the models the service marked default-enabled", () => {
      const catalog = readCopilotPlusCatalog({
        data: [
          { id: "on", default_enabled: true },
          { id: "off", default_enabled: false },
          { id: "unstated" },
        ],
      });

      expect(catalog!.defaultEnabledIds).toEqual(["on"]);
    });

    it.each([
      ["a failed request", null],
      ["a body with no data array", {}],
      ["a non-list data field", { data: "nope" } as unknown as BrevilabsModelsResponse],
      ["an empty lineup", { data: [] }],
      ["an entry with no id", { data: [{ id: "ok" }, { label: "Nameless" }] }],
      ["an entry with a blank id", { data: [{ id: "   " }] }],
      ["a duplicated id", { data: [{ id: "dup" }, { id: "dup" }] }],
      ["a null entry", { data: [null] }],
    ])(
      "rejects %s outright, because a half-read lineup reconciles as a mass withdrawal (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)",
      (_case, payload) => {
        expect(readCopilotPlusCatalog(payload as BrevilabsModelsResponse | null)).toBeNull();
      }
    );

    it("preserves the order the service published", () => {
      const catalog = readCopilotPlusCatalog({
        data: [{ id: "third" }, { id: "first" }, { id: "second" }],
      });

      expect(catalog!.models.map((m) => m.id)).toEqual(["third", "first", "second"]);
    });
  });
});
