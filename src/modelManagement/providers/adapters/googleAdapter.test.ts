import { googleAdapter } from "./googleAdapter";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

import type { Provider } from "@/modelManagement/types/persisted";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "google",
    displayName: "Google",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

describe("googleAdapter", () => {
  describe("verifyCredentials()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
      mockSafeFetch.mockResolvedValue({ status: 200, text: async () => "" } as Response);
    });

    it("verifies against the default Google models endpoint with the key in the query string", async () => {
      const result = await googleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "g-secret",
        extras: {},
      });

      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=g-secret",
        { method: "GET", headers: {} }
      );
    });

    it("url-encodes special characters in the API key", async () => {
      await googleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "weird&key=stuff",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=weird%26key%3Dstuff",
        expect.any(Object)
      );
    });

    it("verifies against the provider base URL without its trailing slash", async () => {
      await googleAdapter.verifyCredentials({
        provider: provider({ baseUrl: "https://proxy.example/" }),
        apiKey: "g",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://proxy.example/v1beta/models?key=g",
        expect.any(Object)
      );
    });

    it("surfaces Google's 400 bad-key response as a readable http_error", async () => {
      mockSafeFetch.mockResolvedValue({
        status: 400,
        text: async () => "API key not valid",
      } as Response);

      const result = await googleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "bad",
        extras: {},
      });

      expect(result).toMatchObject({ ok: false, code: "http_error" });
      expect(result.message).toContain("API key not valid");
    });

    it("returns missing_api_key without sending a request when there is no key", async () => {
      const result = await googleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: null,
        extras: {},
      });

      expect(result).toMatchObject({ ok: false, code: "missing_api_key" });
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it.each(["", "   "])(
      "falls back to the default base URL when the provider base URL is %p",
      async (baseUrl) => {
        await googleAdapter.verifyCredentials({
          provider: provider({ baseUrl }),
          apiKey: "g",
          extras: {},
        });

        expect(mockSafeFetch).toHaveBeenCalledWith(
          "https://generativelanguage.googleapis.com/v1beta/models?key=g",
          expect.any(Object)
        );
      }
    );
  });
});
