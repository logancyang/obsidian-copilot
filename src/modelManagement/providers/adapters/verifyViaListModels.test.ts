/**
 * Tests for the shared `verifyViaListModels` helper.
 *
 * Mocks `@/utils.safeFetchNoThrow` directly to drive each status
 * branch (200 / 401 / 403 / 429 / 500 / thrown error) plus the
 * timeout branch.
 */

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
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("returns ok for 200", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(200));
    const result = await verifyViaListModels("https://example.test/models", { h: "v" });
    expect(result.ok).toBe(true);
    expect(result.checkedAt).toEqual(expect.any(Number));
    expect(mockSafeFetch).toHaveBeenCalledWith("https://example.test/models", {
      method: "GET",
      headers: { h: "v" },
    });
  });

  it("returns ok for 204", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(204));
    expect((await verifyViaListModels("u", {})).ok).toBe(true);
  });

  it("maps 401 to invalid_api_key", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(401));
    const result = await verifyViaListModels("u", {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_api_key");
    expect(result.message).toMatch(/check your API key/i);
  });

  it("maps 403 to invalid_api_key", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(403));
    const result = await verifyViaListModels("u", {});
    expect(result.code).toBe("invalid_api_key");
  });

  it("maps 429 to rate_limited", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(429));
    const result = await verifyViaListModels("u", {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("rate_limited");
  });

  it("maps other non-2xx to http_error and includes the body", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(500, '{"error":"internal server explosion"}'));
    const result = await verifyViaListModels("u", {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("http_error");
    expect(result.message).toContain("500");
    expect(result.message).toContain("internal server explosion");
  });

  it("falls back to status-only http_error when the body is empty", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(502));
    const result = await verifyViaListModels("u", {});
    expect(result.message).toBe("HTTP 502");
  });

  it("truncates very long error bodies", async () => {
    const longBody = "x".repeat(500);
    mockSafeFetch.mockResolvedValue(fakeResponse(500, longBody));
    const result = await verifyViaListModels("u", {});
    expect(result.message).toContain("…");
    expect(result.message?.length).toBeLessThan(longBody.length);
  });

  it("surfaces 400 body text so Gemini-style bad-key responses are readable", async () => {
    mockSafeFetch.mockResolvedValue(fakeResponse(400, "API key not valid"));
    const result = await verifyViaListModels("u", {});
    expect(result.code).toBe("http_error");
    expect(result.message).toContain("API key not valid");
  });

  it("maps thrown fetch errors to network", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await verifyViaListModels("u", {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("network");
    expect(result.message).toBe("ECONNREFUSED");
  });

  it("returns code: timeout (distinct from network) when the fetch hangs past timeoutMs", async () => {
    mockSafeFetch.mockImplementation(() => new Promise(() => {}));
    const result = await verifyViaListModels("u", {}, { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("timeout");
    expect(result.message).toMatch(/timed out/i);
  });
});
