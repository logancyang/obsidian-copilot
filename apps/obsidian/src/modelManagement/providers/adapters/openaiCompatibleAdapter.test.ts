import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

import type { Provider } from "@/modelManagement/types/persisted";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function respondWith(status: number): void {
  mockSafeFetch.mockResolvedValue({ status, text: async () => "" } as Response);
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

const OPENROUTER = {
  baseUrl: "https://openrouter.ai/api/v1",
  origin: { kind: "byok", catalogProviderId: "openrouter" },
} as const;

describe("openaiCompatibleAdapter", () => {
  describe("verifyCredentials()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
      respondWith(200);
    });

    it("sends Bearer auth to the provider's models endpoint when an API key is set", async () => {
      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-openai",
        extras: {},
      });

      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-openai" },
      });
    });

    it("sends no Authorization header for a keyless provider such as Ollama", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ baseUrl: "http://localhost:11434/v1" }),
        apiKey: null,
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("http://localhost:11434/v1/models", {
        method: "GET",
        headers: {},
      });
    });

    it("adds the OpenAI-Organization header when extras carry an organization id", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-openai",
        extras: { openAIOrgId: "org-abc" },
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-openai", "OpenAI-Organization": "org-abc" },
      });
    });

    it("strips the trailing slash from the base URL", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ baseUrl: "https://example.test/v1/" }),
        apiKey: "k",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://example.test/v1/models",
        expect.any(Object)
      );
    });

    it("uses the plain models endpoint for catalog providers other than OpenRouter", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ origin: { kind: "byok", catalogProviderId: "groq" } }),
        apiKey: "k",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.any(Object)
      );
    });

    it("verifies OpenRouter against its auth-gated /key path because public /models would always succeed", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(OPENROUTER),
        apiKey: "sk-or",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: { Authorization: "Bearer sk-or" },
      });
    });

    it("reports invalid_api_key when OpenRouter's /key rejects the key with 401", async () => {
      respondWith(401);

      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(OPENROUTER),
        apiKey: "sk-wrong",
        extras: {},
      });

      expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
    });

    it.each([undefined, "   "])(
      "returns missing_base_url without sending a request when the base URL is %p",
      async (baseUrl) => {
        const result = await openaiCompatibleAdapter.verifyCredentials({
          provider: provider({ baseUrl }),
          apiKey: "sk-openai",
          extras: {},
        });

        expect(result).toMatchObject({ ok: false, code: "missing_base_url" });
        expect(mockSafeFetch).not.toHaveBeenCalled();
      }
    );
  });
});
