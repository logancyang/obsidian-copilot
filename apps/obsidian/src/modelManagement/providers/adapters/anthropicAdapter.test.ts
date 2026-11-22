import { anthropicAdapter } from "./anthropicAdapter";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

import type { Provider } from "@/modelManagement/types/persisted";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

const ANTHROPIC_HEADERS = {
  "x-api-key": "sk-ant",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

describe("anthropicAdapter", () => {
  describe("verifyCredentials()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
      mockSafeFetch.mockResolvedValue({ status: 200, text: async () => "" } as Response);
    });

    it("verifies against the default Anthropic models endpoint with the key and version headers", async () => {
      const result = await anthropicAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-ant",
        extras: {},
      });

      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: ANTHROPIC_HEADERS,
      });
    });

    it("verifies against the provider base URL without its trailing slash", async () => {
      await anthropicAdapter.verifyCredentials({
        provider: provider({ baseUrl: "https://proxy.example/" }),
        apiKey: "sk-ant",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://proxy.example/v1/models",
        expect.any(Object)
      );
    });

    it("reports invalid_api_key when Anthropic rejects the key", async () => {
      mockSafeFetch.mockResolvedValue({ status: 401, text: async () => "" } as Response);

      const result = await anthropicAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-ant",
        extras: {},
      });

      expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
    });

    it("returns missing_api_key without sending a request when there is no key", async () => {
      const result = await anthropicAdapter.verifyCredentials({
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
        await anthropicAdapter.verifyCredentials({
          provider: provider({ baseUrl }),
          apiKey: "sk-ant",
          extras: {},
        });

        expect(mockSafeFetch).toHaveBeenCalledWith(
          "https://api.anthropic.com/v1/models",
          expect.any(Object)
        );
      }
    );
  });
});
