import { codexBinaryPathPlaceholder, codexInstallCommand } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });

  describe("codexInstallCommand()", () => {
    it("uses the collision-safe native PowerShell bootstrap on Windows", () => {
      expect(codexInstallCommand("win32")).toBe(
        "irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/ca3aa97df262a8b30b64818dcb19062a582e5e09/docs/install-codex-agent-mode-windows.ps1 | iex"
      );
    });

    it("uses npm directly outside Windows", () => {
      expect(codexInstallCommand("darwin")).toBe("npm install -g @agentclientprotocol/codex-acp");
    });
  });
});
