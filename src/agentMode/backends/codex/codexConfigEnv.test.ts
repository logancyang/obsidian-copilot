import { mergeCodexConfigEnv } from "@/agentMode/backends/codex/codexConfigEnv";

describe("codexConfigEnv", () => {
  describe("mergeCodexConfigEnv()", () => {
    it("builds the managed Codex configuration without inherited values", () => {
      expect(JSON.parse(mergeCodexConfigEnv(undefined, "Use the vault."))).toEqual({
        developer_instructions: "Use the vault.",
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      });
    });

    it("preserves unrelated values while overriding inherited managed fields", () => {
      const existing = JSON.stringify({
        model: "custom-model",
        developer_instructions: "Ignore the vault.",
        approval_policy: "never",
        approvals_reviewer: "auto_review",
        sandbox_mode: "danger-full-access",
      });

      expect(JSON.parse(mergeCodexConfigEnv(existing, "Use the vault."))).toEqual({
        model: "custom-model",
        developer_instructions: "Use the vault.",
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      });
    });
  });
});
