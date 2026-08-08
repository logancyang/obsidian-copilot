/**
 * Tests for `anthropicAdapter.verifyCredentials`.
 *
 * Mocks the shared `verifyViaListModels` helper so we can assert the
 * URL + headers without exercising the helper's status-mapping logic
 * (covered separately).
 */

import { anthropicAdapter } from "./anthropicAdapter";

jest.mock("./verifyViaListModels", () => ({
  verifyViaListModels: jest.fn(),
}));

import { verifyViaListModels } from "./verifyViaListModels";

import type { Provider } from "@/modelManagement/types/persisted";

const mockVerify = verifyViaListModels as jest.MockedFunction<typeof verifyViaListModels>;

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

describe("anthropicAdapter.verifyCredentials", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, checkedAt: 1 });
  });

  it("returns missing_api_key when apiKey is null", async () => {
    const result = await anthropicAdapter.verifyCredentials({
      provider: provider(),
      apiKey: null,
      extras: {},
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("missing_api_key");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("hits the default base URL when provider.baseUrl is unset", async () => {
    await anthropicAdapter.verifyCredentials({
      provider: provider(),
      apiKey: "sk-ant",
      extras: {},
    });
    expect(mockVerify).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        "x-api-key": "sk-ant",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      })
    );
  });

  it("uses provider.baseUrl when set, stripping trailing slash", async () => {
    await anthropicAdapter.verifyCredentials({
      provider: provider({ baseUrl: "https://proxy.example/" }),
      apiKey: "sk-ant",
      extras: {},
    });
    expect(mockVerify).toHaveBeenCalledWith("https://proxy.example/v1/models", expect.any(Object));
  });

  it("falls back to the default base URL when provider.baseUrl is empty or whitespace", async () => {
    for (const baseUrl of ["", "   "]) {
      mockVerify.mockClear();
      await anthropicAdapter.verifyCredentials({
        provider: provider({ baseUrl }),
        apiKey: "sk-ant",
        extras: {},
      });
      expect(mockVerify).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        expect.any(Object)
      );
    }
  });
});
