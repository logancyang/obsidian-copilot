import {
  codexBinaryPathPlaceholder,
  codexSignInCommand,
  managedCodexRuntimePath,
} from "./cliSetup";

const DIRECT_RUNTIME_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/686";

describe("cliSetup", () => {
  describe("managedCodexRuntimePath()", () => {
    it(`locates the bundled native Codex beside a managed adapter: ${DIRECT_RUNTIME_ISSUE}`, () => {
      expect(
        managedCodexRuntimePath("/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-acp", "darwin")
      ).toBe("/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-runtime/bin/codex");
      expect(
        managedCodexRuntimePath(
          "C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-acp.exe",
          "win32"
        )
      ).toBe("C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-runtime\\bin\\codex.exe");
    });
  });
  describe("codexSignInCommand()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 targets the configured native adapter and profile without exposing API keys", () => {
      expect(
        codexSignInCommand(
          "/custom codex-acp/codex-acp",
          "custom",
          { CODEX_HOME: "/profile", CODEX_PATH: "/custom codex", OPENAI_API_KEY: "secret" },
          "darwin"
        )
      ).toBe(
        "CODEX_HOME=/profile CODEX_PATH='/custom codex' '/custom codex-acp/codex-acp' cli login"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 runs Windows npm adapters through Node and native adapters directly", () => {
      const profile = { CODEX_HOME: "/profile", CODEX_PATH: "/custom codex" };
      expect(codexSignInCommand("C:\\npm\\index.js", "custom", profile, "win32")).toBe(
        "$env:CODEX_HOME = '/profile'; $env:CODEX_PATH = '/custom codex'; node 'C:\\npm\\index.js' cli login"
      );
      expect(codexSignInCommand("C:\\native\\codex-acp.exe", undefined, profile, "win32")).toBe(
        "$env:CODEX_HOME = '/profile'; $env:CODEX_PATH = '/custom codex'; & 'C:\\native\\codex-acp.exe' cli login"
      );
    });
    it(`signs a managed install in through its bundled Codex with a quoted path and profile: ${DIRECT_RUNTIME_ISSUE}`, () => {
      const profile = {
        CODEX_HOME: "/profile",
        CODEX_PATH: "/ignored codex",
        OPENAI_API_KEY: "secret",
      };
      expect(
        codexSignInCommand(
          "/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-acp",
          "managed",
          profile,
          "darwin"
        )
      ).toBe(
        "CODEX_HOME=/profile '/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-runtime/bin/codex' login"
      );
      expect(
        codexSignInCommand(
          "C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-acp.exe",
          "managed",
          profile,
          "win32"
        )
      ).toBe(
        "$env:CODEX_HOME = '/profile'; & 'C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-runtime\\bin\\codex.exe' login"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 omits terminal sign-in until a binary is selected", () => {
      expect(codexSignInCommand(undefined, undefined, undefined, "darwin")).toBeNull();
      expect(codexSignInCommand("", "managed", undefined, "darwin")).toBeNull();
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
