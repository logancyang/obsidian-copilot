import { safeFetchNoThrow } from "@/utils";

import {
  fetchWithListModelsTimeout,
  ListModelsTimeoutError,
  parseModelListResponse,
  readBodySnippet,
} from "./listModelsHttp";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse({
  status = 200,
  json = {},
  text = "",
}: {
  status?: number;
  json?: unknown;
  text?: string;
} = {}): Response {
  return {
    status,
    json: jest.fn(async () => json),
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe("listModelsHttp", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  describe("fetchWithListModelsTimeout()", () => {
    it("returns the provider response and forwards the request options", async () => {
      const response = fakeResponse();
      mockSafeFetch.mockResolvedValue(response);

      await expect(
        fetchWithListModelsTimeout("https://api.example/models", {
          method: "GET",
          headers: { Authorization: "Bearer token" },
        })
      ).resolves.toBe(response);
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.example/models", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      });
    });

    it("rejects with ListModelsTimeoutError when the provider request does not settle", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));

      await expect(
        fetchWithListModelsTimeout("https://api.example/models", {}, 1)
      ).rejects.toBeInstanceOf(ListModelsTimeoutError);
    });
  });

  describe("readBodySnippet()", () => {
    it("trims and truncates long response bodies", async () => {
      const response = fakeResponse({ text: `  ${"a".repeat(201)}  ` });

      await expect(readBodySnippet(response)).resolves.toBe(`${"a".repeat(200)}…`);
    });

    it("returns an empty string when the response body cannot be read", async () => {
      const response = fakeResponse();
      (response.text as jest.Mock).mockRejectedValue(new Error("stream closed"));

      await expect(readBodySnippet(response)).resolves.toBe("");
    });
  });

  describe("parseModelListResponse()", () => {
    it("returns authentication status metadata without parsing the body", async () => {
      const response = fakeResponse({ status: 401 });

      await expect(
        parseModelListResponse(response, { listKey: "data", idKey: "id" })
      ).resolves.toEqual({
        ok: false,
        message: "Authentication failed — check your API key.",
        status: 401,
      });
      expect(response.json).not.toHaveBeenCalled();
    });

    it("includes the response status and body snippet for other HTTP failures", async () => {
      const response = fakeResponse({ status: 503, text: "temporarily unavailable" });

      await expect(
        parseModelListResponse(response, { listKey: "data", idKey: "id" })
      ).resolves.toEqual({
        ok: false,
        message: "HTTP 503: temporarily unavailable",
        status: 503,
      });
    });

    it("reports unreadable JSON with the successful HTTP status", async () => {
      const response = fakeResponse();
      (response.json as jest.Mock).mockRejectedValue(new Error("invalid JSON"));

      await expect(
        parseModelListResponse(response, { listKey: "data", idKey: "id" })
      ).resolves.toEqual({
        ok: false,
        message: "Endpoint returned an unreadable response.",
        status: 200,
      });
    });

    it("rejects a payload whose selected list key is not an array", async () => {
      const response = fakeResponse({ json: { data: "not-a-list" } });

      await expect(
        parseModelListResponse(response, { listKey: "data", idKey: "id" })
      ).resolves.toEqual({
        ok: false,
        message: "Endpoint did not return a model list.",
        status: 200,
      });
    });

    it("selects the configured list and id keys, normalizes ids, and removes invalid duplicates", async () => {
      const response = fakeResponse({
        json: {
          models: [
            { name: " models/gemini-2.5-pro " },
            { name: "models/gemini-2.5-pro" },
            { name: "models/gemini-2.5-flash" },
            { name: 42 },
            null,
          ],
        },
      });

      await expect(
        parseModelListResponse(response, {
          listKey: "models",
          idKey: "name",
          normalizeId: (id) => id.replace(/^models\//, ""),
        })
      ).resolves.toEqual({
        ok: true,
        modelIds: ["gemini-2.5-pro", "gemini-2.5-flash"],
      });
    });
  });
});
