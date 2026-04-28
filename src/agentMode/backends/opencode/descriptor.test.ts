import { OpencodeBackendDescriptor } from "./descriptor";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("OpencodeBackendDescriptor.parseEffortFromModelId", () => {
  const parse = OpencodeBackendDescriptor.parseEffortFromModelId!;

  it("parses 2-segment ids as bare/default", () => {
    expect(parse("anthropic/claude-sonnet-4-5")).toEqual({
      baseId: "anthropic/claude-sonnet-4-5",
      effort: null,
    });
  });

  it("parses 3-segment ids as variants when the suffix is a known effort", () => {
    expect(parse("anthropic/claude-sonnet-4-5/medium")).toEqual({
      baseId: "anthropic/claude-sonnet-4-5",
      effort: "medium",
    });
    expect(parse("openai/gpt-5/minimal")).toEqual({
      baseId: "openai/gpt-5",
      effort: "minimal",
    });
  });

  it("returns null for 3-segment ids whose suffix isn't a known effort", () => {
    // OpenRouter-style ids share the 3-segment shape but the trailing
    // segment is part of the model name, not an effort. Must not be parsed
    // as a variant or the dedupe path collapses unrelated models.
    expect(parse("openrouter/anthropic/claude-sonnet-4-5")).toBeNull();
    expect(parse("a/b/c")).toBeNull();
  });

  it("returns null for unparseable shapes (1 or 4+ segments)", () => {
    expect(parse("just-a-name")).toBeNull();
    expect(parse("a/b/c/d")).toBeNull();
    expect(parse("")).toBeNull();
  });
});

describe("OpencodeBackendDescriptor.composeModelId", () => {
  const compose = OpencodeBackendDescriptor.composeModelId!;

  it("returns the bare baseId when effort is null", () => {
    expect(compose("anthropic/claude-sonnet-4-5", null)).toBe("anthropic/claude-sonnet-4-5");
  });

  it("appends the variant when effort is set", () => {
    expect(compose("anthropic/claude-sonnet-4-5", "high")).toBe("anthropic/claude-sonnet-4-5/high");
  });

  it("round-trips via parseEffortFromModelId", () => {
    const ids = [
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-5/low",
      "openai/gpt-5/high",
    ];
    for (const id of ids) {
      const parsed = OpencodeBackendDescriptor.parseEffortFromModelId!(id);
      expect(parsed).not.toBeNull();
      expect(compose(parsed!.baseId, parsed!.effort)).toBe(id);
    }
  });
});
