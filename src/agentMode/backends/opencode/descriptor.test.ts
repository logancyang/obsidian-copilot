import { OpencodeBackendDescriptor } from "./descriptor";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("OpencodeBackendDescriptor.wire.decode", () => {
  const decode = OpencodeBackendDescriptor.wire.decode;

  it("parses 2-segment ids as bare/default with provider mapped to Copilot", () => {
    expect(decode("anthropic/claude-sonnet-4-5")).toEqual({
      selection: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
      provider: "anthropic",
    });
  });

  it("parses 3-segment ids as variants when the suffix is a known effort", () => {
    expect(decode("anthropic/claude-sonnet-4-5/medium")).toEqual({
      selection: { baseModelId: "anthropic/claude-sonnet-4-5", effort: "medium" },
      provider: "anthropic",
    });
    expect(decode("openai/gpt-5/minimal")).toEqual({
      selection: { baseModelId: "openai/gpt-5", effort: "minimal" },
      provider: "openai",
    });
  });

  it("recognizes opencode's full effort vocabulary (none/minimal/low/medium/high/xhigh/max)", () => {
    // Opencode advertises Anthropic models with `/max` and `/xhigh` and
    // OpenRouter reasoning models with `/none`. Each must collapse onto
    // its bare base.
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(decode(`anthropic/claude-opus-4-7/${effort}`)).toEqual({
        selection: { baseModelId: "anthropic/claude-opus-4-7", effort },
        provider: "anthropic",
      });
    }
  });

  it("returns no-effort representation for 3-segment ids whose suffix isn't a known effort", () => {
    // OpenRouter-style 3-segment ids without an effort suffix — the
    // trailing segment is part of the model name. The whole id is the
    // baseModelId; provider is still attributed from the leading segment.
    expect(decode("openrouter/anthropic/claude-sonnet-4-5")).toEqual({
      selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4-5", effort: null },
      provider: "openrouterai",
    });
    expect(decode("openrouter/anthropic/claude-3.5-haiku")).toEqual({
      selection: { baseModelId: "openrouter/anthropic/claude-3.5-haiku", effort: null },
      provider: "openrouterai",
    });
  });

  it("parses 4-segment umbrella ids as variants when the last segment is a known effort", () => {
    // OpenRouter wraps native ids under `openrouter/`, so its variants
    // are 4-segment: `openrouter/<sub>/<model>/<effort>`. Without this
    // case the picker would render seven duplicate rows per OpenRouter
    // reasoning model.
    expect(decode("openrouter/anthropic/claude-sonnet-4.5/high")).toEqual({
      selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4.5", effort: "high" },
      provider: "openrouterai",
    });
    expect(decode("openrouter/anthropic/claude-sonnet-4.5/none")).toEqual({
      selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4.5", effort: "none" },
      provider: "openrouterai",
    });
    expect(decode("openrouter/openai/gpt-5/xhigh")).toEqual({
      selection: { baseModelId: "openrouter/openai/gpt-5", effort: "xhigh" },
      provider: "openrouterai",
    });
    // OpenRouter route variants like `:exacto` live inside the model
    // segment — the effort suffix still attaches at the trailing slash.
    expect(decode("openrouter/openai/gpt-oss-120b:exacto/none")).toEqual({
      selection: { baseModelId: "openrouter/openai/gpt-oss-120b:exacto", effort: "none" },
      provider: "openrouterai",
    });
  });

  it("returns no-effort representation for unparseable shapes (1 segment or unknown trailing segment)", () => {
    // 1-segment ids have no provider segment to attribute.
    expect(decode("just-a-name")).toEqual({
      selection: { baseModelId: "just-a-name", effort: null },
      provider: null,
    });
    // 4+ segment ids whose trailing segment isn't a known effort fall
    // through to a no-effort representation. The leading segment still
    // attributes a provider when it maps.
    expect(decode("anthropic/foo/bar/baz")).toEqual({
      selection: { baseModelId: "anthropic/foo/bar/baz", effort: null },
      provider: "anthropic",
    });
    expect(decode("a/b/c/d")).toEqual({
      selection: { baseModelId: "a/b/c/d", effort: null },
      provider: null,
    });
  });
});

describe("OpencodeBackendDescriptor.wire.encode", () => {
  const encode = OpencodeBackendDescriptor.wire.encode;

  it("returns the bare baseModelId when effort is null", () => {
    expect(encode({ baseModelId: "anthropic/claude-sonnet-4-5", effort: null })).toBe(
      "anthropic/claude-sonnet-4-5"
    );
  });

  it("appends the variant when effort is set", () => {
    expect(encode({ baseModelId: "anthropic/claude-sonnet-4-5", effort: "high" })).toBe(
      "anthropic/claude-sonnet-4-5/high"
    );
  });

  it("round-trips via wire.decode", () => {
    const ids = [
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-5/low",
      "openai/gpt-5/high",
      "anthropic/claude-opus-4-7/max",
      "openrouter/anthropic/claude-sonnet-4.5",
      "openrouter/anthropic/claude-sonnet-4.5/none",
      "openrouter/anthropic/claude-sonnet-4.5/high",
    ];
    for (const id of ids) {
      const decoded = OpencodeBackendDescriptor.wire.decode(id);
      expect(encode(decoded.selection)).toBe(id);
    }
  });
});

describe("OpencodeBackendDescriptor.isModelEnabledByDefault", () => {
  const fn = OpencodeBackendDescriptor.isModelEnabledByDefault!;

  it("matches 'Big Pickle' in name", () => {
    expect(fn({ modelId: "anthropic/foo", name: "Big Pickle" })).toBe(true);
    expect(fn({ modelId: "anthropic/foo", name: "BIG PICKLE" })).toBe(true);
    expect(fn({ modelId: "anthropic/foo", name: "big-pickle" })).toBe(true);
  });

  it("matches 'big-pickle' in modelId", () => {
    expect(fn({ modelId: "openai/big-pickle", name: "Some Display" })).toBe(true);
    expect(fn({ modelId: "openai/big_pickle", name: "Some Display" })).toBe(true);
  });

  it("returns false for unrelated models", () => {
    expect(fn({ modelId: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" })).toBe(false);
    expect(fn({ modelId: "openai/gpt-5", name: "GPT-5" })).toBe(false);
  });
});
