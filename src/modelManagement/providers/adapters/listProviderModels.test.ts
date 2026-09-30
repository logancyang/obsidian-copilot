import { listProviderModels } from "./listProviderModels";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function respondWithJson(json: unknown): void {
  mockSafeFetch.mockResolvedValue({
    status: 200,
    json: async () => json,
    text: async () => "",
  } as unknown as Response);
}

describe("listProviderModels", () => {
  describe("listProviderModels()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("lists openai-compatible models from <baseUrl>/models with the key and organization from extras", async () => {
      respondWithJson({ data: [{ id: "gpt-5" }] });

      const result = await listProviderModels("openai-compatible", "https://api.openai.com/v1", {
        apiKey: "sk",
        extras: { openAIOrgId: "org-9" },
      });

      expect(result).toEqual({ ok: true, modelIds: ["gpt-5"] });
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk", "OpenAI-Organization": "org-9" },
      });
    });

    it("sends no organization header when extras.openAIOrgId is not a string", async () => {
      respondWithJson({ data: [] });

      await listProviderModels("openai-compatible", "https://api.openai.com/v1", {
        extras: { openAIOrgId: 7 },
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {},
      });
    });

    it("lists anthropic models from /v1/models with the x-api-key header", async () => {
      respondWithJson({ data: [{ id: "claude-sonnet-4-5" }] });

      const result = await listProviderModels("anthropic", "https://api.anthropic.com", {
        apiKey: "sk-ant",
      });

      expect(result).toEqual({ ok: true, modelIds: ["claude-sonnet-4-5"] });
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: { "anthropic-version": "2023-06-01", "x-api-key": "sk-ant" },
      });
    });

    it("lists google models from /v1beta/models with the key query parameter", async () => {
      respondWithJson({ models: [{ name: "models/gemini-2.0-flash" }] });

      const result = await listProviderModels(
        "google",
        "https://generativelanguage.googleapis.com",
        {
          apiKey: "key",
        }
      );

      expect(result).toEqual({ ok: true, modelIds: ["gemini-2.0-flash"] });
      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=key",
        { method: "GET", headers: {} }
      );
    });

    it.each(["openai-compatible", "anthropic", "google"] as const)(
      "reports a timeout for %s when the request hangs past timeoutMs",
      async (providerType) => {
        mockSafeFetch.mockImplementation(() => new Promise(() => {}));

        const result = await listProviderModels(providerType, "https://example.test", {
          timeoutMs: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message).toMatch(/timed out/i);
      }
    );
  });
});
