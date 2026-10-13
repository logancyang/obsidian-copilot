import { COMPACT_COMMAND_NAME, isCompactCommand } from "@/commands/compactCommand";

describe("compactCommand", () => {
  describe("COMPACT_COMMAND_NAME", () => {
    it("is the command word agents advertise for compaction", () => {
      expect(COMPACT_COMMAND_NAME).toBe("compact");
    });
  });

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
