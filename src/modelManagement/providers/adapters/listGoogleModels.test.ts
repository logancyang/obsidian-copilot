import { listGoogleModels } from "./listGoogleModels";

jest.mock("@/utils", () => ({ safeFetchNoThrow: jest.fn() }));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse(status: number, json: unknown, text = ""): Response {
  return { status, json: async () => json, text: async () => text } as unknown as Response;
}

describe("listGoogleModels", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("strips the `models/` prefix and sends the API key in the query string", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, {
        models: [
          { name: "models/gemini-2.0-flash", displayName: "Gemini 2 Flash" },
          { name: "models/gemini-2.5-pro" },
        ],
      })
    );
    const result = await listGoogleModels("https://generativelanguage.googleapis.com", {
      apiKey: "abc/xyz",
    });
    expect(result).toEqual({
      ok: true,
      modelIds: ["gemini-2.0-flash", "gemini-2.5-pro"],
    });
    // url-encoded api key in the query string
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=abc%2Fxyz",
      { method: "GET", headers: {} }
    );
  });

  it("omits the ?key= when no API key is provided and strips a trailing slash", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200, { models: [] }));
    await listGoogleModels("https://generativelanguage.googleapis.com/");
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { method: "GET", headers: {} }
    );
  });

  it("returns ok:false without fetching when the base URL is blank", async () => {
    const result = await listGoogleModels("   ");
    expect(result.ok).toBe(false);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("maps 401 to an auth message", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(401, {}));
    const result = await listGoogleModels("u", { apiKey: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/API key/i);
  });

  it("dedupes ids and skips entries without a string name", async () => {
    mockSafeFetch.mockResolvedValue(
      fakeResponse(200, {
        models: [
          { name: "models/a" },
          { name: "models/a" },
          {},
          { name: 7 },
          { name: "b" },
          { name: "models/b" },
        ],
      })
    );
    const result = await listGoogleModels("u");
    expect(result).toEqual({ ok: true, modelIds: ["a", "b"] });
  });

  it("reports an unreadable list when models is not an array", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200, { models: "nope" }));
    const result = await listGoogleModels("u");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/model list/i);
  });

  it("times out when the fetch hangs past timeoutMs", async () => {
    mockSafeFetch.mockImplementation(() => new Promise(() => {}));
    const result = await listGoogleModels("u", { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/timed out/i);
  });
});
