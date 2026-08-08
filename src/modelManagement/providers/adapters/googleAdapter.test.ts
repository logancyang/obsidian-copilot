/**
 * Tests for `googleAdapter.verifyCredentials`.
 */

import { googleAdapter } from "./googleAdapter";

jest.mock("./verifyViaListModels", () => ({
  verifyViaListModels: jest.fn(),
}));

import { verifyViaListModels } from "./verifyViaListModels";

import type { Provider } from "@/modelManagement/types/persisted";

const mockVerify = verifyViaListModels as jest.MockedFunction<typeof verifyViaListModels>;

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

describe("googleAdapter.verifyCredentials", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, checkedAt: 1 });
  });

  it("returns missing_api_key when apiKey is null", async () => {
    const result = await googleAdapter.verifyCredentials({
      provider: provider(),
      apiKey: null,
      extras: {},
    });
    expect(result.code).toBe("missing_api_key");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("passes apiKey via query param against the default base URL", async () => {
    await googleAdapter.verifyCredentials({
      provider: provider(),
      apiKey: "g-secret",
      extras: {},
    });
    expect(mockVerify).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=g-secret",
      {}
    );
  });

  it("url-encodes special characters in the apiKey", async () => {
    await googleAdapter.verifyCredentials({
      provider: provider(),
      apiKey: "weird&key=stuff",
      extras: {},
    });
    expect(mockVerify).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=weird%26key%3Dstuff",
      {}
    );
  });

  it("respects provider.baseUrl override", async () => {
    await googleAdapter.verifyCredentials({
      provider: provider({ baseUrl: "https://proxy.example/" }),
      apiKey: "g",
      extras: {},
    });
    expect(mockVerify).toHaveBeenCalledWith("https://proxy.example/v1beta/models?key=g", {});
  });

  it("falls back to the default base URL when provider.baseUrl is empty or whitespace", async () => {
    for (const baseUrl of ["", "   "]) {
      mockVerify.mockClear();
      await googleAdapter.verifyCredentials({
        provider: provider({ baseUrl }),
        apiKey: "g",
        extras: {},
      });
      expect(mockVerify).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=g",
        {}
      );
    }
  });
});
