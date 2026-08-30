import { codexBinaryPathPlaceholder } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });
});
