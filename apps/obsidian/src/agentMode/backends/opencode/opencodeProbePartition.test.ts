import { partitionOpencodeOnlyWireIds } from "./opencodeProbePartition";

describe("opencodeProbePartition", () => {
  describe("partitionOpencodeOnlyWireIds()", () => {
    it("drops wire ids whose provider id is in the managed set", () => {
      const managed = new Set(["anthropic", "openai"]);
      const result = partitionOpencodeOnlyWireIds(
        ["anthropic/claude-sonnet-4-5", "openai/gpt-5", "opencode/big-pickle"],
        managed
      );
      expect(result).toEqual(["opencode/big-pickle"]);
    });

    it("keeps every reported id when the managed set is empty", () => {
      const result = partitionOpencodeOnlyWireIds(
        ["opencode/big-pickle", "opencode/small-gherkin"],
        new Set()
      );
      expect(result).toEqual(["opencode/big-pickle", "opencode/small-gherkin"]);
    });

    it("attributes a multi-segment wire id to its first segment as provider id", () => {
      const managed = new Set(["openrouter"]);
      const result = partitionOpencodeOnlyWireIds(
        ["openrouter/anthropic/claude-3.5-haiku", "mistral/large/latest"],
        managed
      );
      expect(result).toEqual(["mistral/large/latest"]);
    });

    it("keeps a wire id with no slash because it has no provider segment", () => {
      const result = partitionOpencodeOnlyWireIds(["bare-model"], new Set(["anthropic"]));
      expect(result).toEqual(["bare-model"]);
    });

    it("removes repeated wire ids", () => {
      const result = partitionOpencodeOnlyWireIds(
        ["opencode/big-pickle", "opencode/big-pickle"],
        new Set()
      );
      expect(result).toEqual(["opencode/big-pickle"]);
    });

    it("keeps the reported order of surviving ids", () => {
      const result = partitionOpencodeOnlyWireIds(
        ["opencode/c", "opencode/a", "opencode/b"],
        new Set()
      );
      expect(result).toEqual(["opencode/c", "opencode/a", "opencode/b"]);
    });

    it("returns the same frozen empty array for any managed set when no ids are reported", () => {
      const a = partitionOpencodeOnlyWireIds([], new Set());
      const b = partitionOpencodeOnlyWireIds([], new Set(["anthropic"]));
      expect(a).toEqual([]);
      expect(Object.isFrozen(a)).toBe(true);
      expect(a).toBe(b);
    });

    it("returns the shared frozen empty array when every reported id is managed", () => {
      const empty = partitionOpencodeOnlyWireIds([], new Set());
      const result = partitionOpencodeOnlyWireIds(
        ["anthropic/claude-sonnet-4-5"],
        new Set(["anthropic"])
      );
      expect(result).toEqual([]);
      expect(result).toBe(empty);
    });
  });
});
