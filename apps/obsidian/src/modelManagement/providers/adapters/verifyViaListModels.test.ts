import { verifyViaListModels } from "./verifyViaListModels";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function fakeResponse(status: number, body = ""): Response {
  return { status, text: async () => body } as unknown as Response;
}

describe("verifyViaListModels", () => {
  describe("verifyViaListModels()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("returns ok and sends a GET with the given headers for 200", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200));
      const result = await verifyViaListModels("https://example.test/models", { h: "v" });
      expect(result.ok).toBe(true);
      expect(result.checkedAt).toEqual(expect.any(Number));
      expect(mockSafeFetch).toHaveBeenCalledWith("https://example.test/models", {
        method: "GET",
        headers: { h: "v" },
      });
    });

    it("returns ok for any other 2xx status such as 204", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(204));
      expect((await verifyViaListModels("u", {})).ok).toBe(true);
    });

    it.each([401, 403])(
      "maps %i to invalid_api_key with a check-your-key message",
      async (status) => {
        mockSafeFetch.mockResolvedValue(fakeResponse(status));
        const result = await verifyViaListModels("u", {});
        expect(result.ok).toBe(false);
        expect(result.code).toBe("invalid_api_key");
        expect(result.message).toMatch(/check your API key/i);
      }
    );

    it("maps 429 to rate_limited", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(429));
      const result = await verifyViaListModels("u", {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe("rate_limited");
    });

    it("maps other non-2xx statuses to http_error including the response body", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(500, '{"error":"internal server explosion"}'));
      const result = await verifyViaListModels("u", {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe("http_error");
      expect(result.message).toContain("500");
      expect(result.message).toContain("internal server explosion");
    });

    it("reports only the HTTP status when the error body is empty", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(502));
      const result = await verifyViaListModels("u", {});
      expect(result.message).toBe("HTTP 502");
    });

    it("truncates a very long error body", async () => {
      const longBody = "x".repeat(500);
      mockSafeFetch.mockResolvedValue(fakeResponse(500, longBody));
      const result = await verifyViaListModels("u", {});
      expect(result.message).toContain("…");
      expect(result.message?.length).toBeLessThan(longBody.length);
    });

    it("includes the body of a 400 response so a Gemini-style bad-key message is readable", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(400, "API key not valid"));
      const result = await verifyViaListModels("u", {});
      expect(result.code).toBe("http_error");
      expect(result.message).toContain("API key not valid");
    });

    it("maps a thrown fetch error to network with its message", async () => {
      mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await verifyViaListModels("u", {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe("network");
      expect(result.message).toBe("ECONNREFUSED");
    });

    it("reports timeout, distinct from network, when the fetch hangs past timeoutMs", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));
      const result = await verifyViaListModels("u", {}, { timeoutMs: 5 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("timeout");
      expect(result.message).toMatch(/timed out/i);
    });
  });
});
