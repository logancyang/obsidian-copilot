import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({ signInWithCli: jest.fn() }));
import { parseClaudeAuthStatusOutput, signInToClaude } from "./claudeAuth";

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
