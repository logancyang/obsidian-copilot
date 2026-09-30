import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse(status: number, json: unknown, text = ""): Response {
  return { status, json: async () => json, text: async () => text } as unknown as Response;
}

describe("listOpenAICompatibleModels", () => {
  describe("listOpenAICompatibleModels()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("returns the model ids from the OpenAI data list", async () => {
      mockSafeFetch.mockResolvedValue(
        fakeResponse(200, { data: [{ id: "llama3.2" }, { id: "qwen2.5-coder:7b" }] })
      );
      const result = await listOpenAICompatibleModels("http://localhost:11434/v1");
      expect(result).toEqual({
        ok: true,
        modelIds: ["llama3.2", "qwen2.5-coder:7b"],
      });
    });

    it("requests /models from the base URL without its trailing slash", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200, { data: [] }));
      await listOpenAICompatibleModels("http://localhost:1234/v1/");
      expect(mockSafeFetch).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
        method: "GET",
        headers: {},
      });
    });

    it("sends the Bearer key and organization headers when provided", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200, { data: [] }));
      await listOpenAICompatibleModels("https://api.example/v1", {
        apiKey: "sk-123",
        openAIOrgId: "org-9",
      });
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.example/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-123", "OpenAI-Organization": "org-9" },
      });
    });

    it("fails without sending a request when the base URL is blank", async () => {
      const result = await listOpenAICompatibleModels("   ");
      expect(result.ok).toBe(false);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("reports an authentication failure without a /v1 hint for a 401", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(401, {}));
      const result = await listOpenAICompatibleModels("http://localhost:1234", { apiKey: "bad" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/API key/i);
        expect(result.message).not.toMatch(/\/v1/);
      }
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("reports the message of a thrown network error", async () => {
      mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await listOpenAICompatibleModels("u");
      expect(result).toEqual({ ok: false, message: "ECONNREFUSED" });
    });

    it("reports a timeout when the request hangs past timeoutMs", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));
      const result = await listOpenAICompatibleModels("u", { timeoutMs: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/timed out/i);
    });

    it("sends a single request and adds a /v1 hint to a 404 when the base URL has no /v1", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(404, undefined, "Not Found"));
      const result = await listOpenAICompatibleModels("http://127.0.0.1:1234");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/HTTP 404/);
        expect(result.message).toMatch(/\/v1/);
      }
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      expect(mockSafeFetch).toHaveBeenCalledWith("http://127.0.0.1:1234/models", {
        method: "GET",
        headers: {},
      });
    });

    it("adds no /v1 hint to a 404 when the base URL already ends in /v1", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(404, undefined, "Not Found"));
      const result = await listOpenAICompatibleModels("http://localhost:1234/v1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toMatch(/add it to the base URL/);
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("adds no /v1 hint to a 404 when /v1 appears mid-path such as Groq's /openai/v1", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(404, undefined, "Not Found"));
      const result = await listOpenAICompatibleModels("https://api.groq.com/openai/v1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toMatch(/add it to the base URL/);
    });
  });
});
