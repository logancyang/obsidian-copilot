import { CODEX_AUTH_COMMAND, codexBinaryPathPlaceholder } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });

  it("signs in through the adapter's bundled Codex CLI", () => {
    expect(CODEX_AUTH_COMMAND).toBe("npx -y @agentclientprotocol/codex-acp@1.10.0 cli login");
  });
});
