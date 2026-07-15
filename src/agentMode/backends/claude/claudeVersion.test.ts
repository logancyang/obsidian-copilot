import {
  assertClaudeVersionSupported,
  CLAUDE_MIN_VERSION,
  parseClaudeVersionOutput,
  probeClaudeVersion,
  type ClaudeVersionRunner,
} from "./claudeVersion";

describe("claudeVersion", () => {
  describe("parseClaudeVersionOutput()", () => {
    it("returns the semantic version from Claude Code output", () => {
      expect(parseClaudeVersionOutput("2.1.206 (Claude Code)\n")).toBe("2.1.206");
    });
  });

  describe("probeClaudeVersion()", () => {
    it.each([
      "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      "C:\\nvm\\node_modules\\@anthropic-ai\\claude-code\\cli-wrapper.cjs",
    ])("runs script fallback %s through Node instead of executing it directly", async (script) => {
      const run = jest.fn().mockResolvedValue({ stdout: `${CLAUDE_MIN_VERSION} (Claude Code)` });

      await expect(probeClaudeVersion(script, process.env, run)).resolves.toEqual({
        kind: "supported",
        version: CLAUDE_MIN_VERSION,
      });
      expect(run).toHaveBeenCalledWith(process.execPath, [script, "--version"], {
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
        timeout: 10_000,
      });
    });

    it("executes native binaries directly without the Node launcher", async () => {
      const run = jest.fn().mockResolvedValue({ stdout: `${CLAUDE_MIN_VERSION} (Claude Code)` });

      await probeClaudeVersion("/usr/local/bin/claude", process.env, run);

      expect(run).toHaveBeenCalledWith("/usr/local/bin/claude", ["--version"], {
        env: process.env,
        timeout: 10_000,
      });
    });

    it("returns incompatible metadata for an older Claude Code version", async () => {
      const run = jest.fn().mockResolvedValue({ stdout: "2.1.205 (Claude Code)" });

      await expect(probeClaudeVersion("/usr/local/bin/claude", process.env, run)).resolves.toEqual({
        kind: "incompatible",
        currentVersion: "2.1.205",
        minVersion: CLAUDE_MIN_VERSION,
        message:
          "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer.",
      });
    });
  });

  describe("assertClaudeVersionSupported()", () => {
    it("accepts the minimum supported version", async () => {
      const run = jest.fn().mockResolvedValue({ stdout: `${CLAUDE_MIN_VERSION} (Claude Code)` });

      await expect(
        assertClaudeVersionSupported("/usr/local/bin/claude", process.env, run)
      ).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledWith("/usr/local/bin/claude", ["--version"], {
        env: process.env,
        timeout: 10_000,
      });
    });

    it("throws for an older version without embedding install instructions", async () => {
      const run = jest.fn().mockResolvedValue({ stdout: "2.1.205 (Claude Code)" });

      await expect(
        assertClaudeVersionSupported("/usr/local/bin/claude", process.env, run)
      ).rejects.toThrow(
        "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer."
      );
      await expect(
        assertClaudeVersionSupported("/usr/local/bin/claude", process.env, run)
      ).rejects.not.toThrow("npm install");
    });

    it("throws when the output does not contain a version", async () => {
      const run: ClaudeVersionRunner = jest
        .fn()
        .mockResolvedValue({ stdout: "Claude Code unknown" });

      await expect(
        assertClaudeVersionSupported("/usr/local/bin/claude", process.env, run)
      ).rejects.toThrow("Could not read the installed Claude Code version");
    });
  });
});
