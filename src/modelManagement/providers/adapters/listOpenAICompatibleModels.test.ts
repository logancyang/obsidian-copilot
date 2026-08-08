/**
 * Tests for `listOpenAICompatibleModels`.
 *
 * Mocks `@/utils.safeFetchNoThrow` to drive the success / parse /
 * auth / http-error / timeout branches.
 */

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
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("parses the OpenAI { data: [{ id }] } shape", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, { data: [{ id: "llama3.2" }, { id: "qwen2.5-coder:7b" }] })
    );
    const result = await listOpenAICompatibleModels("http://localhost:11434/v1");
    expect(result).toEqual({
      ok: true,
      modelIds: ["llama3.2", "qwen2.5-coder:7b"],
    });
  });

  it("strips a trailing slash and hits /models", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200, { data: [] }));
    await listOpenAICompatibleModels("http://localhost:1234/v1/");
    expect(mockSafeFetch).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      headers: {},
    });
  });

  it("sends the auth + org headers when provided", async () => {
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

  it("dedupes ids and skips entries without a string id", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, { data: [{ id: "a" }, { id: "a" }, {}, { id: 7 }, { id: " b " }] })
    );
    const result = await listOpenAICompatibleModels("u");
    expect(result).toEqual({ ok: true, modelIds: ["a", "b"] });
  });

  it("returns ok:false without fetching when the base URL is blank", async () => {
    const result = await listOpenAICompatibleModels("   ");
    expect(result.ok).toBe(false);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("maps 401 to an auth message with no /v1 hint", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(401, {}));
    const result = await listOpenAICompatibleModels("http://localhost:1234", { apiKey: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/API key/i);
      expect(result.message).not.toMatch(/\/v1/);
    }
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("includes the body snippet on other non-2xx", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(500, undefined, "boom"));
    const result = await listOpenAICompatibleModels("u");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("HTTP 500: boom");
  });

  it("reports an unreadable list when data is not an array", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200, { data: "nope" }));
    const result = await listOpenAICompatibleModels("u");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/model list/i);
  });

  it("maps thrown fetch errors to a message", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await listOpenAICompatibleModels("u");
    expect(result).toEqual({ ok: false, message: "ECONNREFUSED" });
  });

  it("times out when the fetch hangs past timeoutMs", async () => {
    mockSafeFetch.mockImplementation(() => new Promise(() => {}));
    const result = await listOpenAICompatibleModels("u", { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/timed out/i);
  });

  it("makes a single request — no /v1 retry — and reports the 404 with a /v1 hint", async () => {
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

  it("does not add the /v1 hint when the base already ends in /v1", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(404, undefined, "Not Found"));
    const result = await listOpenAICompatibleModels("http://localhost:1234/v1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/add it to the base URL/);
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("does not add the /v1 hint when /v1 appears mid-path (e.g. Groq /openai/v1)", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(404, undefined, "Not Found"));
    const result = await listOpenAICompatibleModels("https://api.groq.com/openai/v1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/add it to the base URL/);
  });
});
