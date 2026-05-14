import { CodexBackendDescriptor } from "./descriptor";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("CodexBackendDescriptor.isModelEnabledByDefault", () => {
  const fn = CodexBackendDescriptor.isModelEnabledByDefault!;

  it("matches gpt-5.5 family by modelId", () => {
    expect(fn({ modelId: "gpt-5.5", name: "GPT-5.5" })).toBe(true);
    expect(fn({ modelId: "gpt-5.5/high", name: "GPT-5.5 (high)" })).toBe(true);
  });

  it("matches gpt-5.5 family by display name", () => {
    expect(fn({ modelId: "some-internal-id", name: "GPT-5.5" })).toBe(true);
  });

  it("does not match version numbers that merely contain 5.5", () => {
    expect(fn({ modelId: "model-15.5-x", name: "Model 15.5x" })).toBe(false);
    expect(fn({ modelId: "model-5.50", name: "Model 5.50" })).toBe(false);
  });

  it("rejects unrelated models", () => {
    expect(fn({ modelId: "gpt-5", name: "GPT-5" })).toBe(false);
    expect(fn({ modelId: "gpt-5-codex/high", name: "GPT-5 Codex (high)" })).toBe(false);
    expect(fn({ modelId: "o3", name: "o3" })).toBe(false);
  });
});
