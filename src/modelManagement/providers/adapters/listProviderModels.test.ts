import { listProviderModels } from "./listProviderModels";

jest.mock("./listOpenAICompatibleModels", () => ({
  listOpenAICompatibleModels: jest.fn(),
}));
jest.mock("./listAnthropicModels", () => ({
  listAnthropicModels: jest.fn(),
}));
jest.mock("./listGoogleModels", () => ({
  listGoogleModels: jest.fn(),
}));

import { listAnthropicModels } from "./listAnthropicModels";
import { listGoogleModels } from "./listGoogleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

const mockOAI = listOpenAICompatibleModels as jest.MockedFunction<
  typeof listOpenAICompatibleModels
>;
const mockAnthropic = listAnthropicModels as jest.MockedFunction<typeof listAnthropicModels>;
const mockGoogle = listGoogleModels as jest.MockedFunction<typeof listGoogleModels>;

describe("listProviderModels", () => {
  beforeEach(() => {
    mockOAI.mockReset();
    mockAnthropic.mockReset();
    mockGoogle.mockReset();
  });

  it("routes openai-compatible to listOpenAICompatibleModels and forwards openAIOrgId from extras", async () => {
    mockOAI.mockResolvedValue({ ok: true, modelIds: ["gpt-5"] });
    const result = await listProviderModels("openai-compatible", "https://api.openai.com/v1", {
      apiKey: "sk",
      extras: { openAIOrgId: "org-9" },
      timeoutMs: 1234,
    });
    expect(result).toEqual({ ok: true, modelIds: ["gpt-5"] });
    expect(mockOAI).toHaveBeenCalledWith("https://api.openai.com/v1", {
      apiKey: "sk",
      openAIOrgId: "org-9",
      timeoutMs: 1234,
    });
  });

  it("ignores non-string openAIOrgId in extras", async () => {
    mockOAI.mockResolvedValue({ ok: true, modelIds: [] });
    await listProviderModels("openai-compatible", "u", { extras: { openAIOrgId: 7 } });
    expect(mockOAI).toHaveBeenCalledWith("u", {
      apiKey: undefined,
      openAIOrgId: undefined,
      timeoutMs: undefined,
    });
  });

  it("routes anthropic to listAnthropicModels", async () => {
    mockAnthropic.mockResolvedValue({ ok: true, modelIds: ["claude"] });
    const result = await listProviderModels("anthropic", "https://api.anthropic.com", {
      apiKey: "sk-ant",
    });
    expect(result).toEqual({ ok: true, modelIds: ["claude"] });
    expect(mockAnthropic).toHaveBeenCalledWith("https://api.anthropic.com", {
      apiKey: "sk-ant",
      timeoutMs: undefined,
    });
  });

  it("routes google to listGoogleModels", async () => {
    mockGoogle.mockResolvedValue({ ok: true, modelIds: ["gemini-2.0-flash"] });
    const result = await listProviderModels("google", "https://generativelanguage.googleapis.com", {
      apiKey: "key",
    });
    expect(result).toEqual({ ok: true, modelIds: ["gemini-2.0-flash"] });
    expect(mockGoogle).toHaveBeenCalledWith("https://generativelanguage.googleapis.com", {
      apiKey: "key",
      timeoutMs: undefined,
    });
  });

  it("returns null for azure and bedrock", async () => {
    expect(await listProviderModels("azure", "https://example.openai.azure.com")).toBeNull();
    expect(
      await listProviderModels("bedrock", "https://bedrock.us-east-1.amazonaws.com")
    ).toBeNull();
    expect(mockOAI).not.toHaveBeenCalled();
    expect(mockAnthropic).not.toHaveBeenCalled();
    expect(mockGoogle).not.toHaveBeenCalled();
  });
});
