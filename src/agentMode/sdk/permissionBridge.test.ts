import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { PermissionBridge, type AskUserQuestionPrompter } from "./permissionBridge";

describe("permissionBridge", () => {
  describe("PermissionBridge", () => {
    describe("canUseTool()", () => {
      function makeBridge(
        prompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null,
        askUserQuestionPrompter?: AskUserQuestionPrompter
      ) {
        return new PermissionBridge("session-1", {
          getPrompter: () => prompter,
          getAskUserQuestionPrompter: askUserQuestionPrompter
            ? () => askUserQuestionPrompter
            : undefined,
        });
      }

      class FakeQuestionSession {
        pending: AskUserQuestionPrompt | null = null;
        private resolver: ((answers: AgentQuestionAnswers) => void) | null = null;
        readonly handle: AskUserQuestionPrompter = (req) => {
          this.pending = req;
          return new Promise<AgentQuestionAnswers>((resolve) => {
            this.resolver = resolve;
          });
        };
        resolve(answers: AgentQuestionAnswers): void {
          this.resolver?.(answers);
        }
      }

      const ctx = {
        signal: new AbortController().signal,
        toolUseID: "toolu_test_id",
      } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];

      it("prompts with the tool kind, call id, raw input, and the four allow/reject options", async () => {
        let captured: PermissionPrompt | null = null;
        const bridge = makeBridge(async (req) => {
          captured = req;
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        });
        await bridge.canUseTool("Edit", { file_path: "a.md" }, ctx);
        expect(captured).not.toBeNull();
        expect(captured!.toolCall.kind).toBe("edit");
        expect(captured!.toolCall.toolCallId).toBe("toolu_test_id");
        expect(captured!.toolCall.rawInput).toEqual({ file_path: "a.md" });
        expect(captured!.options.map((o) => o.kind)).toEqual([
          "allow_once",
          "allow_always",
          "reject_once",
          "reject_always",
        ]);
      });

      it("allows with the original input when the user picks allow_once", async () => {
        const bridge = makeBridge(async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }));
        const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
        expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
      });

      it("allows and forwards the SDK permission suggestions when the user picks allow_always", async () => {
        const bridge = makeBridge(async () => ({
          outcome: { outcome: "selected", optionId: "allow_always" },
        }));
        const ctxWithSuggestions = {
          signal: new AbortController().signal,
          suggestions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash" }],
              behavior: "allow",
              destination: "session",
            } as unknown,
          ],
        } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];
        const result = await bridge.canUseTool("Bash", { command: "ls" }, ctxWithSuggestions);
        expect(result.behavior).toBe("allow");
        if (result.behavior === "allow") {
          expect(result.updatedInput).toEqual({ command: "ls" });
          expect(result.updatedPermissions).toHaveLength(1);
        }
      });

      it("denies with a declined message when the user picks reject_once", async () => {
        const bridge = makeBridge(async () => ({
          outcome: { outcome: "selected", optionId: "reject_once" },
        }));
        const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
        expect(result.behavior).toBe("deny");
        if (result.behavior === "deny") expect(result.message).toContain("declined");
      });

      it("denies with the user-supplied message when the rejection carries one", async () => {
        const bridge = makeBridge(async () => ({
          outcome: { outcome: "selected", optionId: "reject_once" },
          denyMessage: "Please drop the second step and only do step 1.",
        }));
        const result = await bridge.canUseTool("ExitPlanMode", { plan: "# x" }, ctx);
        expect(result.behavior).toBe("deny");
        if (result.behavior === "deny") {
          expect(result.message).toBe("Please drop the second step and only do step 1.");
        }
      });

      it("allows without a message when an allow decision carries a denyMessage", async () => {
        const bridge = makeBridge(async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
          denyMessage: "this should be ignored",
        }));
        const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
        expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
      });

      it("denies when the prompt is cancelled", async () => {
        const bridge = makeBridge(async () => ({ outcome: { outcome: "cancelled" } }));
        const result = await bridge.canUseTool("Bash", {}, ctx);
        expect(result.behavior).toBe("deny");
      });

      it("denies when no permission prompter is registered", async () => {
        const bridge = new PermissionBridge("session-1", { getPrompter: () => null });
        const result = await bridge.canUseTool("Edit", { file_path: "a.md" }, ctx);
        expect(result.behavior).toBe("deny");
      });

      it("denies AskUserQuestion when no ask-question prompter is configured", async () => {
        const bridge = makeBridge(async () => ({ outcome: { outcome: "cancelled" } }));
        const result = await bridge.canUseTool(
          "AskUserQuestion",
          { questions: [{ question: "Q", options: [{ label: "A" }] }] },
          ctx
        );
        expect(result.behavior).toBe("deny");
      });

      it("asks the question prompter for a session-scoped request and allows with the submitted answers", async () => {
        const fake = new FakeQuestionSession();
        const bridge = makeBridge(null, fake.handle);
        const questions = [
          { question: "Pick a fruit", options: [{ label: "Apple" }, { label: "Pear" }] },
        ];
        const resultPromise = bridge.canUseTool("AskUserQuestion", { questions }, ctx);
        expect(fake.pending).toEqual({
          sessionId: "session-1",
          requestId: "toolu_test_id",
          questions,
        });

        fake.resolve({ "Pick a fruit": "Pear" });
        const result = await resultPromise;
        expect(result).toEqual({
          behavior: "allow",
          updatedInput: { questions, answers: { "Pick a fruit": "Pear" } },
        });
      });

      it("denies AskUserQuestion with a cancellation message when the answers are empty", async () => {
        const fake = new FakeQuestionSession();
        const bridge = makeBridge(null, fake.handle);
        const resultPromise = bridge.canUseTool(
          "AskUserQuestion",
          { questions: [{ question: "Q", options: [{ label: "A" }] }] },
          ctx
        );

        fake.resolve({});
        const result = await resultPromise;
        expect(result.behavior).toBe("deny");
        if (result.behavior === "deny") {
          expect(result.message).toBe("User cancelled the question");
        }
      });

      describe("Write tool gating", () => {
        function makeBridgeWithPlanMatcher(
          isPlanModePlanFilePath: (p: string) => boolean,
          prompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null = null
        ) {
          return new PermissionBridge("session-1", {
            getPrompter: () => prompter,
            isPlanModePlanFilePath,
          });
        }

        it("auto-allows Write when file_path matches the plan-mode predicate", async () => {
          const prompter = jest.fn();
          const bridge = makeBridgeWithPlanMatcher(
            (p) => p.endsWith("/.claude/plans/foo.md"),
            prompter
          );
          const result = await bridge.canUseTool(
            "Write",
            { file_path: "/Users/x/.claude/plans/foo.md", content: "# plan" },
            ctx
          );
          expect(result.behavior).toBe("allow");
          if (result.behavior === "allow") {
            expect(result.updatedInput).toEqual({
              file_path: "/Users/x/.claude/plans/foo.md",
              content: "# plan",
            });
          }
          expect(prompter).not.toHaveBeenCalled();
        });

        it("routes non-plan Write through the permission prompter", async () => {
          let captured: PermissionPrompt | null = null;
          const bridge = makeBridgeWithPlanMatcher(
            () => false,
            async (req) => {
              captured = req;
              return { outcome: { outcome: "selected", optionId: "allow_once" } };
            }
          );
          const result = await bridge.canUseTool(
            "Write",
            { file_path: "/tmp/foo.md", content: "x" },
            ctx
          );
          expect(captured).not.toBeNull();
          expect(captured!.toolCall.kind).toBe("edit");
          expect(captured!.toolCall.vendorToolName).toBe("Write");
          expect(result).toEqual({
            behavior: "allow",
            updatedInput: { file_path: "/tmp/foo.md", content: "x" },
          });
        });

        it("routes Write through the prompter even with no plan predicate configured", async () => {
          const prompter = jest.fn(async () => ({
            outcome: { outcome: "selected" as const, optionId: "reject_once" as const },
          }));
          const bridge = new PermissionBridge("session-1", { getPrompter: () => prompter });
          const result = await bridge.canUseTool(
            "Write",
            { file_path: "/Users/x/.claude/plans/foo.md", content: "x" },
            ctx
          );
          expect(prompter).toHaveBeenCalled();
          expect(result.behavior).toBe("deny");
        });
      });

      describe("read-only fan-out session gating", () => {
        it("denies a plan-file Write BEFORE the plan-file auto-allow when the session is read-only", async () => {
          const planMatcher = jest.fn((p: string) => p.endsWith("/.claude/plans/foo.md"));
          const prompter = jest.fn();
          const bridge = new PermissionBridge("session-1", {
            getPrompter: () => prompter,
            isPlanModePlanFilePath: planMatcher,
            getIsReadOnlySession: () => () => true,
          });

          const result = await bridge.canUseTool(
            "Write",
            { file_path: "/Users/x/.claude/plans/foo.md", content: "# plan" },
            ctx
          );

          expect(result.behavior).toBe("deny");
          if (result.behavior === "deny") {
            expect(result.message).toContain("Read-only QA turn");
          }
          expect(planMatcher).not.toHaveBeenCalled();
          expect(prompter).not.toHaveBeenCalled();
        });

        it("still allows reads in a read-only session (only vault writes are denied)", async () => {
          const prompter = jest.fn(async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow_once" as const },
          }));
          const bridge = new PermissionBridge("session-1", {
            getPrompter: () => prompter,
            getIsReadOnlySession: () => () => true,
          });

          const result = await bridge.canUseTool("Read", { file_path: "/tmp/a.md" }, ctx);
          expect(prompter).toHaveBeenCalled();
          expect(result.behavior).toBe("allow");
        });

        it("denies an UNKNOWN MCP tool (kind 'other') in a read-only session — fail safe", async () => {
          const prompter = jest.fn();
          const bridge = new PermissionBridge("session-1", {
            getPrompter: () => prompter,
            getIsReadOnlySession: () => () => true,
          });

          const result = await bridge.canUseTool("mcp__notion__create_page", { title: "x" }, ctx);
          expect(result.behavior).toBe("deny");
          expect(prompter).not.toHaveBeenCalled();
        });

        it("does not gate writes when the session is NOT read-only (plan auto-allow still applies)", async () => {
          const prompter = jest.fn();
          const bridge = new PermissionBridge("session-1", {
            getPrompter: () => prompter,
            isPlanModePlanFilePath: (p) => p.endsWith("/.claude/plans/foo.md"),
            getIsReadOnlySession: () => () => false,
          });

          const result = await bridge.canUseTool(
            "Write",
            { file_path: "/Users/x/.claude/plans/foo.md", content: "# plan" },
            ctx
          );
          expect(result.behavior).toBe("allow");
          expect(prompter).not.toHaveBeenCalled();
        });
      });

      describe("ExitPlanMode handling", () => {
        it("synthesizes a prompt with switch_mode kind and isPlanProposal=true", async () => {
          let captured: PermissionPrompt | null = null;
          const bridge = makeBridge(async (req) => {
            captured = req;
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          });
          const ctxWithToolUse = {
            signal: new AbortController().signal,
            toolUseID: "toolu_plan_xyz",
          } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];
          await bridge.canUseTool("ExitPlanMode", { plan: "# do thing" }, ctxWithToolUse);
          expect(captured).not.toBeNull();
          expect(captured!.toolCall.kind).toBe("switch_mode");
          expect(captured!.toolCall.toolCallId).toBe("toolu_plan_xyz");
          expect(captured!.toolCall.rawInput).toEqual({ plan: "# do thing" });
          expect(captured!.toolCall.vendorToolName).toBe("ExitPlanMode");
          expect(captured!.toolCall.isPlanProposal).toBe(true);
        });

        it("does not set isPlanProposal for non-ExitPlanMode tools", async () => {
          let captured: PermissionPrompt | null = null;
          const bridge = makeBridge(async (req) => {
            captured = req;
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          });
          await bridge.canUseTool("Bash", { command: "ls" }, ctx);
          expect(captured!.toolCall.isPlanProposal).toBeUndefined();
        });

        it("keeps an MCP tool whose bare name is ExitPlanMode out of the plan flow", async () => {
          let captured: PermissionPrompt | null = null;
          const bridge = makeBridge(async (req) => {
            captured = req;
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          });
          await bridge.canUseTool("mcp__srv__ExitPlanMode", { plan: "unrelated" }, ctx);
          expect(captured!.toolCall.mcpServer).toBe("srv");
          expect(captured!.toolCall.isPlanProposal).toBeUndefined();
          expect(captured!.toolCall.kind).not.toBe("switch_mode");
        });
      });
    });
  });
});
