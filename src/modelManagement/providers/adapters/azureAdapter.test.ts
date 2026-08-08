/**
 * Tests for `azureAdapter.verifyCredentials`.
 */

import { azureAdapter } from "./azureAdapter";

jest.mock("./verifyViaListModels", () => ({
  verifyViaListModels: jest.fn(),
}));

import { verifyViaListModels } from "./verifyViaListModels";

import type { Provider } from "@/modelManagement/types/persisted";

const mockVerify = verifyViaListModels as jest.MockedFunction<typeof verifyViaListModels>;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "azure",
    displayName: "Azure",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

const extras = {
  azureInstanceName: "my-org-eastus",
  azureDeploymentName: "gpt-4o",
  azureApiVersion: "2024-08-01-preview",
};

describe("azureAdapter.verifyCredentials", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, checkedAt: 1 });
  });

  it("returns missing_api_key when apiKey is null", async () => {
    const result = await azureAdapter.verifyCredentials({
      provider: provider(),
      apiKey: null,
      extras,
    });
    expect(result.code).toBe("missing_api_key");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("composes the data-plane deployments URL from extras and sends api-key header", async () => {
    await azureAdapter.verifyCredentials({
      provider: provider(),
      apiKey: "azure-secret",
      extras,
    });
    expect(mockVerify).toHaveBeenCalledWith(
      "https://my-org-eastus.openai.azure.com/openai/deployments?api-version=2024-08-01-preview",
      { "api-key": "azure-secret" }
    );
  });

  it("url-encodes the api-version", async () => {
    await azureAdapter.verifyCredentials({
      provider: provider(),
      apiKey: "k",
      extras: { ...extras, azureApiVersion: "2024-08-01 preview" },
    });
    const url = mockVerify.mock.calls[0][0];
    expect(url).toContain("api-version=2024-08-01%20preview");
  });
});

describe("azureAdapter.extrasSchema", () => {
  it("accepts alphanumeric + hyphen instance names", () => {
    expect(() => azureAdapter.extrasSchema.parse(extras)).not.toThrow();
  });

  it.each([
    ["with a slash", "evil.com/foo"],
    ["with a dot", "my.subdomain"],
    ["with a colon", "host:443"],
    ["with an at sign", "user@host"],
    ["with whitespace", "my name"],
  ])("rejects azureInstanceName %s", (_label, azureInstanceName) => {
    expect(() => azureAdapter.extrasSchema.parse({ ...extras, azureInstanceName })).toThrow();
  });
});
