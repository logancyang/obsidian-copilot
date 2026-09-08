const mockExecFileAsync = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) => {
    if (id !== "child_process") return jest.requireActual(`node:${id}`);
    const execFile = Object.assign(jest.fn(), {
      [jest.requireActual<typeof import("node:util")>("node:util").promisify.custom]:
        mockExecFileAsync,
    });
    return { execFile };
  },
}));
import { signInWithCli, signOutWithCli } from "@/agentMode/backends/shared/cliSignIn";
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({
  signInWithCli: jest.fn(),
  signOutWithCli: jest.fn(),
}));
import { parseClaudeAuthStatusOutput, signInToClaude, signOutFromClaude } from "./claudeAuth";

describe("claudeAuth", () => {
  describe("parseClaudeAuthStatusOutput()", () => {
    it("reports signed in with a label from email + subscription", () => {
      const out = JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email: "zero@example.com",
        subscriptionType: "max",
      });
      expect(parseClaudeAuthStatusOutput(out)).toEqual({
        loggedIn: true,
        label: "zero@example.com (max)",
      });
    });

    it("falls back to apiProvider + authMethod when email/subscription are absent", () => {
      const out = JSON.stringify({
        loggedIn: true,
        apiProvider: "bedrock",
        authMethod: "aws",
      });
      expect(parseClaudeAuthStatusOutput(out)).toEqual({
        loggedIn: true,
        label: "bedrock (aws)",
      });
    });

    it("reports signed out for loggedIn:false", () => {
      expect(parseClaudeAuthStatusOutput(JSON.stringify({ loggedIn: false }))).toEqual({
        loggedIn: false,
      });
    });

    it("treats malformed / non-JSON output as signed out", () => {
      expect(parseClaudeAuthStatusOutput("not json")).toEqual({ loggedIn: false });
      expect(parseClaudeAuthStatusOutput("")).toEqual({ loggedIn: false });
    });

    it("treats a payload missing loggedIn as signed out", () => {
      expect(parseClaudeAuthStatusOutput(JSON.stringify({ email: "x@y.z" }))).toEqual({
        loggedIn: false,
      });
    });
  });

  describe("signOutFromClaude()", () => {
    it.each([
      new Error("status startup failed"),
      { killed: true, stdout: '{"loggedIn":false}' },
      { stdout: "malformed status" },
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects failed or timed-out verification after logout: %j",
      async (error) => {
        mockExecFileAsync.mockRejectedValue(error);
        jest
          .mocked(signOutWithCli)
          .mockImplementation(async (_command, _args, _env, readStatus) => readStatus());
        await expect(signOutFromClaude("/cli", {})).rejects.toBeDefined();
        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "/cli",
          ["auth", "status", "--json"],
          expect.objectContaining({ timeout: 10000 })
        );
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 accepts a valid signed-out JSON status even with a nonzero CLI exit", async () => {
      mockExecFileAsync.mockRejectedValue({ stdout: '{"loggedIn":false}' });
      jest
        .mocked(signOutWithCli)
        .mockImplementation(async (_command, _args, _env, readStatus) => readStatus());
      await expect(signOutFromClaude("/cli", {})).resolves.toEqual({ loggedIn: false });
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 uses the configured profile and shared logout lifecycle", async () => {
      const status = { loggedIn: true, label: "zero@example.com (max)" };
      jest.mocked(signOutWithCli).mockResolvedValue(status);
      const options = { signal: new AbortController().signal };
      const env = { CLAUDE_CONFIG_DIR: "/profile" };
      await expect(signOutFromClaude("/cli", env, options)).resolves.toEqual(status);
      expect(signOutWithCli).toHaveBeenCalledWith(
        "/cli",
        ["auth", "logout"],
        env,
        expect.any(Function),
        options
      );
    });
  });
  describe("signInToClaude()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves Claude browser-login arguments through the shared subprocess lifecycle", () => {
      const controller = { done: Promise.resolve({ loggedIn: false }), cancel: jest.fn() };
      jest.mocked(signInWithCli).mockReturnValue(controller);
      const handlers = { signal: new AbortController().signal, onUrl: jest.fn() };
      expect(signInToClaude("/bin/claude", { ANTHROPIC_API_KEY: "test-only" }, handlers)).toBe(
        controller
      );
      expect(signInWithCli).toHaveBeenCalledWith(
        "/bin/claude",
        ["auth", "login", "--claudeai"],
        { ANTHROPIC_API_KEY: "test-only" },
        expect.any(Function),
        handlers
      );
    });
  });
});
