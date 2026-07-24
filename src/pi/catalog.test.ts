import {
  COPILOT_PLUS_PROVIDER_ID,
  FALLBACK_CONTEXT_WINDOW,
  fetchCopilotPlusModels,
  parseContextLength,
} from "@/pi/catalog";
import type { PiFetch } from "@/pi/types";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

function fetchReturning(payload: unknown, ok = true, status = 200): PiFetch {
  return jest.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(payload) }));
}

describe("catalog", () => {
  describe("parseContextLength()", () => {
    it.each([
      ["1M", 1_048_576],
      ["256K", 262_144],
      ["192K", 196_608],
      ["8192", 8192],
      ["128k", 131_072],
      [" 2M ", 2_097_152],
      [1_000_000, 1_000_000],
    ])("maps %p to %p tokens", (input, expected) => {
      expect(parseContextLength(input)).toBe(expected);
    });

    it.each([["huge"], [""], [null], [undefined], [-1], [{}]])(
      "falls back to the conservative window for the unparseable value %p",
      (input) => {
        expect(parseContextLength(input)).toBe(FALLBACK_CONTEXT_WINDOW);
      }
    );
  });

  describe("fetchCopilotPlusModels()", () => {
    it("requests the public catalog endpoint without credentials", async () => {
      const fetchFn = fetchReturning({ object: "list", data: [] });
      await fetchCopilotPlusModels(fetchFn);
      expect(fetchFn).toHaveBeenCalledWith("https://models.brevilabs.com/v1/models");
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("maps catalog rows onto openai-completions models owned by the Copilot Plus provider", async () => {
      const models = await fetchCopilotPlusModels(
        fetchReturning({
          object: "list",
          data: [
            {
              id: "gpt-5",
              label: "GPT-5",
              description: "Frontier model",
              context_length: "256K",
              supports_images: true,
              supports_reasoning: true,
              relative_quota: 3,
            },
          ],
        })
      );

      expect(models).toEqual([
        {
          id: "gpt-5",
          name: "GPT-5",
          description: "Frontier model",
          api: "openai-completions",
          provider: COPILOT_PLUS_PROVIDER_ID,
          baseUrl: "https://models.brevilabs.com/v1",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262_144,
          maxTokens: 8192,
        },
      ]);
    });

    it("treats missing capability flags as unsupported and falls back to the row id for the name", async () => {
      const [model] = await fetchCopilotPlusModels(
        fetchReturning({ data: [{ id: "some-model", context_length: "1M" }] })
      );

      expect(model.name).toBe("some-model");
      expect(model.description).toBeUndefined();
      expect(model.input).toEqual(["text"]);
      expect(model.reasoning).toBe(false);
    });

    it("skips rows without a usable id", async () => {
      const models = await fetchCopilotPlusModels(
        fetchReturning({ data: [{ id: "" }, { label: "no id" }, { id: "kept" }] })
      );

      expect(models.map((model) => model.id)).toEqual(["kept"]);
    });

    it("returns no models when the response carries no model list", async () => {
      expect(await fetchCopilotPlusModels(fetchReturning({ object: "list" }))).toEqual([]);
    });

    it("rejects on a non-OK response so pi keeps the previously known catalog", async () => {
      await expect(fetchCopilotPlusModels(fetchReturning({}, false, 503))).rejects.toThrow(
        "status 503"
      );
    });
  });
});
