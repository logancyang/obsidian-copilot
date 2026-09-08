import { claudeSignInCommand } from "@/agentMode/backends/claude/cliSetup";

describe("cliSetup", () => {
  describe("claudeSignInCommand()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 shows the simple terminal command for an auto-detected installation", () => {
      expect(claudeSignInCommand("claude", undefined, "darwin")).toBe(
        "claude auth login --claudeai"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 targets the selected executable and profile without exposing credential overrides", () => {
      expect(
        claudeSignInCommand(
          "/custom claude",
          {
            CLAUDE_CONFIG_DIR: "/profile",
            XDG_CONFIG_HOME: "/config",
            ANTHROPIC_API_KEY: "secret",
          },
          "darwin"
        )
      ).toBe(
        "CLAUDE_CONFIG_DIR=/profile XDG_CONFIG_HOME=/config '/custom claude' auth login --claudeai"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 omits terminal sign-in until a binary is selected", () => {
      expect(claudeSignInCommand(undefined, undefined, "darwin")).toBeNull();
    });
  });
});
