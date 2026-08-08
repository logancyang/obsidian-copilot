import { partitionOpencodeOnlyWireIds } from "./opencodeProbePartition";

describe("partitionOpencodeOnlyWireIds", () => {
  it("drops wire ids whose provider id is in the managed set", () => {
    const managed = new Set(["anthropic", "openai"]);
    const result = partitionOpencodeOnlyWireIds(
      ["anthropic/claude-sonnet-4-5", "openai/gpt-5", "opencode/big-pickle"],
      managed
    );
    // Only the opencode-only id survives; the BYOK-managed ones are suppressed.
    expect(result).toEqual(["opencode/big-pickle"]);
  });

  it("keeps every opencode-only id when the managed set is empty", () => {
    const result = partitionOpencodeOnlyWireIds(
      ["opencode/big-pickle", "opencode/small-gherkin"],
      new Set()
    );
    expect(result).toEqual(["opencode/big-pickle", "opencode/small-gherkin"]);
  });

  it("treats the FIRST segment as the provider id for multi-segment wire ids", () => {
    const managed = new Set(["openrouter"]);
    const result = partitionOpencodeOnlyWireIds(
      // openrouter is managed → dropped; mistral (first segment) is not → kept.
      ["openrouter/anthropic/claude-3.5-haiku", "mistral/large/latest"],
      managed
    );
    expect(result).toEqual(["mistral/large/latest"]);
  });

  it("suppresses a copilot-plus managed id", () => {
    const managed = new Set(["copilot-plus"]);
    const result = partitionOpencodeOnlyWireIds(
      ["copilot-plus/some-model", "opencode/big-pickle"],
      managed
    );
    expect(result).toEqual(["opencode/big-pickle"]);
  });

  it("keeps a wire id with no slash (no provider segment to attribute)", () => {
    const result = partitionOpencodeOnlyWireIds(["bare-model"], new Set(["anthropic"]));
    expect(result).toEqual(["bare-model"]);
  });

  it("de-duplicates repeated wire ids", () => {
    const result = partitionOpencodeOnlyWireIds(
      ["opencode/big-pickle", "opencode/big-pickle"],
      new Set()
    );
    expect(result).toEqual(["opencode/big-pickle"]);
  });

  it("preserves report order of the kept ids", () => {
    const result = partitionOpencodeOnlyWireIds(
      ["opencode/c", "opencode/a", "opencode/b"],
      new Set()
    );
    expect(result).toEqual(["opencode/c", "opencode/a", "opencode/b"]);
  });

  it("returns a frozen empty array (referential stability) for empty input", () => {
    const a = partitionOpencodeOnlyWireIds([], new Set());
    const b = partitionOpencodeOnlyWireIds([], new Set(["anthropic"]));
    expect(a).toEqual([]);
    expect(Object.isFrozen(a)).toBe(true);
    // Same frozen constant returned for every empty case.
    expect(a).toBe(b);
  });

  it("returns the frozen empty array when every reported id is suppressed", () => {
    const empty = partitionOpencodeOnlyWireIds([], new Set());
    const result = partitionOpencodeOnlyWireIds(
      ["anthropic/claude-sonnet-4-5"],
      new Set(["anthropic"])
    );
    expect(result).toEqual([]);
    expect(result).toBe(empty);
  });
});
