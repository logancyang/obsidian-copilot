import { CODEX_AUTH_COMMAND, CODEX_INSTALL_COMMAND, codexBinaryPathPlaceholder } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });

  it("removes the conflicting Zed package before installing the supported adapter", () => {
    expect(CODEX_INSTALL_COMMAND).toBe(
      "npm uninstall -g @zed-industries/codex-acp; npm install -g @agentclientprotocol/codex-acp"
    );
  });

  it("signs in through the adapter's bundled Codex CLI", () => {
    expect(CODEX_AUTH_COMMAND).toBe("codex-acp login");
  });
});
