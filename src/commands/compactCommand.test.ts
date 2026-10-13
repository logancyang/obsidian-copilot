import { isCompactCommand } from "@/commands/compactCommand";

describe("compactCommand", () => {
  describe("isCompactCommand()", () => {
    it.each([
      "/compact",
      "  /compact  ",
      "/compact focus on the API",
      "/compact\tkeep the schema",
      "/compact\nkeep the schema",
    ])("recognizes %j as the compact command", (text) => {
      expect(isCompactCommand(text)).toBe(true);
    });

    it.each([
      "hello",
      "",
      "/compaction",
      "/compactor now",
      "please /compact",
      "compact",
      "/Compact",
    ])("does not recognize %j", (text) => {
      expect(isCompactCommand(text)).toBe(false);
    });
  });
});
