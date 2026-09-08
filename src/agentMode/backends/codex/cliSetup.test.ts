import { codexBinaryPathPlaceholder, codexSignInCommand } from "./cliSetup";

describe("cliSetup", () => {
  describe("codexSignInCommand()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 targets the configured native adapter and profile without exposing API keys", () => {
      expect(
        codexSignInCommand(
          "/managed codex/codex-acp",
          { CODEX_HOME: "/profile", CODEX_PATH: "/custom codex", OPENAI_API_KEY: "secret" },
          "darwin"
        )
      ).toBe("CODEX_HOME=/profile CODEX_PATH='/custom codex' '/managed codex/codex-acp' cli login");
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 runs Windows npm adapters through Node and native adapters directly", () => {
      const profile = { CODEX_HOME: "/profile", CODEX_PATH: "/custom codex" };
      expect(codexSignInCommand("C:\\npm\\index.js", profile, "win32")).toBe(
        "$env:CODEX_HOME = '/profile'; $env:CODEX_PATH = '/custom codex'; node 'C:\\npm\\index.js' cli login"
      );
      expect(codexSignInCommand("C:\\native\\codex-acp.exe", profile, "win32")).toBe(
        "$env:CODEX_HOME = '/profile'; $env:CODEX_PATH = '/custom codex'; & 'C:\\native\\codex-acp.exe' cli login"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 omits terminal sign-in until a binary is selected", () => {
      expect(codexSignInCommand(undefined, undefined, "darwin")).toBeNull();
    });
  });
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });
});
