import { codexBinaryPathPlaceholder } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the native executable on Windows and the extensionless binary elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe("/absolute/path/to/codex-acp.exe");
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });
});
