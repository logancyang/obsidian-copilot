import { listAnthropicModels } from "./listAnthropicModels";

jest.mock("@/utils", () => ({ safeFetchNoThrow: jest.fn() }));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse(status: number, json: unknown, text = ""): Response {
  return { status, json: async () => json, text: async () => text } as unknown as Response;
}

describe("listAnthropicModels", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("parses the { data: [{ id }] } shape and sends the auth + version headers", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, {
        data: [
          { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
          { id: "claude-opus-4-7", display_name: "Claude Opus 4.7" },
        ],
      })
    );
    const result = await listAnthropicModels("https://api.anthropic.com", { apiKey: "sk-ant" });
    expect(result).toEqual({
      ok: true,
      modelIds: ["claude-sonnet-4-5", "claude-opus-4-7"],
    });
    expect(mockSafeFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: { "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" },
    });
  });

  it("strips a trailing slash and omits x-api-key when no key is provided", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200, { data: [] }));
    await listAnthropicModels("https://api.anthropic.com/");
    expect(mockSafeFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: { "anthropic-version": "2023-06-01" },
    });
  });

  it("returns ok:false without fetching when the base URL is blank", async () => {
    const result = await listAnthropicModels("   ");
    expect(result.ok).toBe(false);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("maps 401 to an auth message", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(401, {}));
    const result = await listAnthropicModels("https://api.anthropic.com", { apiKey: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/API key/i);
  });

  it("includes the body snippet on other non-2xx", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(500, undefined, "internal error"));
    const result = await listAnthropicModels("u");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("HTTP 500: internal error");
  });

  it("dedupes ids and skips non-string entries", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, { data: [{ id: "a" }, { id: "a" }, {}, { id: 7 }, { id: " b " }] })
    );
    const result = await listAnthropicModels("u");
    expect(result).toEqual({ ok: true, modelIds: ["a", "b"] });
  });

  it("times out when the fetch hangs past timeoutMs", async () => {
    mockSafeFetch.mockImplementation(() => new Promise(() => {}));
    const result = await listAnthropicModels("u", { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/timed out/i);
  });
});
