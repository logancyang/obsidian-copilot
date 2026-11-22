import { isOpencodeZenWireId } from "@/utils/opencodeModelId";

describe("opencodeModelId", () => {
  describe("isOpencodeZenWireId()", () => {
    it.each([
      ["opencode/big-pickle", true],
      ["opencode/deepseek-v4-flash-free", true],
      ["lmstudio/gpt-oss-20b", false],
      ["openrouter/anthropic/claude", false],
      ["opencode-zen/x", false],
    ])("classifies %s as Zen: %s", (id, expected) => {
      expect(isOpencodeZenWireId(id)).toBe(expected);
    });
  });
});
