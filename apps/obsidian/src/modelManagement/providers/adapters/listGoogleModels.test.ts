import { listGoogleModels } from "./listGoogleModels";

jest.mock("@/utils", () => ({ safeFetchNoThrow: jest.fn() }));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse(status: number, json: unknown, text = ""): Response {
  return { status, json: async () => json, text: async () => text } as unknown as Response;
}

describe("listGoogleModels", () => {
  describe("listGoogleModels()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("returns model ids without the models/ prefix and sends the API key in the query string", async () => {
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
      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=abc%2Fxyz",
        { method: "GET", headers: {} }
      );
    });

    it("omits the key query parameter when no key is given and strips a trailing slash from the base URL", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200, { models: [] }));
      await listGoogleModels("https://generativelanguage.googleapis.com/");
      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models",
        { method: "GET", headers: {} }
      );
    });

    it("fails without sending a request when the base URL is blank", async () => {
      const result = await listGoogleModels("   ");
      expect(result.ok).toBe(false);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("reports a timeout when the request hangs past timeoutMs", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));
      const result = await listGoogleModels("u", { timeoutMs: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/timed out/i);
    });
  });
});
