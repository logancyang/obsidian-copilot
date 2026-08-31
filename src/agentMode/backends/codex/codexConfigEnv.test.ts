import { mergeCodexConfigEnv } from "@/agentMode/backends/codex/codexConfigEnv";

describe("codexConfigEnv", () => {
  describe("mergeCodexConfigEnv()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/322 applies the product context defaults without inherited values", () => {
      expect(JSON.parse(mergeCodexConfigEnv(undefined, "Use the vault."))).toEqual({
        model_context_window: 1_000_000,
        model_auto_compact_token_limit: 500_000,
        developer_instructions: "Use the vault.",
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/322 preserves user context values while overriding Copilot-owned fields", () => {
      const existing = JSON.stringify({
        model: "custom-model",
        model_context_window: 400_000,
        model_auto_compact_token_limit: 300_000,
        developer_instructions: "Ignore the vault.",
        approval_policy: "never",
        approvals_reviewer: "auto_review",
        sandbox_mode: "danger-full-access",
      });

      expect(JSON.parse(mergeCodexConfigEnv(existing, "Use the vault."))).toEqual({
        model: "custom-model",
        model_context_window: 400_000,
        model_auto_compact_token_limit: 300_000,
        developer_instructions: "Use the vault.",
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      });
    });
  });
});
