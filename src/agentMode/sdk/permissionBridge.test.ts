import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { PermissionBridge, type AskUserQuestionPrompter } from "./permissionBridge";

jest.mock("@/agents/customAgentsGate", () => ({ getCustomAgentsGate: () => "full" }));

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

      it("prompts with the tool kind, call id, raw input, and only one-time options when Claude Code suggests no rule for https://github.com/logancyang/obsidian-copilot/issues/2889", async () => {
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
        expect(captured!.options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 labels a request with the subagent that made it, and the main agent otherwise", async () => {
        const requesters: PermissionPrompt["requester"][] = [];
        const bridge = makeBridge(async (req) => {
          requesters.push(req.requester);
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        });

        await bridge.canUseTool("Edit", { file_path: "a.md" }, ctx);
        await bridge.canUseTool("Edit", { file_path: "a.md" }, { ...ctx, agentID: "task-a" });

        expect(requesters).toEqual(["main", { taskId: "task-a" }]);
      });

      it.each([
        ["session", "Covers Bash(git add:*) until this chat ends. Start a new chat to undo."],
        [
          "localSettings",
          "Covers Bash(git add:*). Saved to .claude/settings.local.json in the vault folder (for a project chat, the project note's folder), for later chats there. Remove it there to undo.",
        ],
        [
          "userSettings",
          "Covers Bash(git add:*). Saved to settings.json in your Claude Code config folder (~/.claude by default), for all your Claude Code projects. Remove it there to undo.",
        ],
      ])(
        "offers allow_always scoped to a %s rule suggestion for https://github.com/logancyang/obsidian-copilot/issues/2889",
        async (destination, scope) => {
          let captured: PermissionPrompt | null = null;
          const bridge = makeBridge(async (req) => {
            captured = req;
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          });
          await bridge.canUseTool("Bash", { command: "git add ." }, {
            ...ctx,
            suggestions: [
              {
                type: "addRules",
                rules: [{ toolName: "Bash", ruleContent: "git add:*" }],
                behavior: "allow",
                destination,
              },
            ],
          } as unknown as Parameters<PermissionBridge["canUseTool"]>[2]);
          expect(captured!.options.map((o) => [o.kind, o.description])).toEqual([
            ["allow_once", undefined],
            ["allow_always", scope],
            ["reject_once", undefined],
          ]);
        }
      );

      it("names file-edit mode and added directories in a session scope for https://github.com/logancyang/obsidian-copilot/issues/2889", async () => {
        let captured: PermissionPrompt | null = null;
        const bridge = makeBridge(async (req) => {
          captured = req;
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        });
        await bridge.canUseTool("Edit", { file_path: "/notes/a.md" }, {
          ...ctx,
          suggestions: [
            { type: "setMode", mode: "acceptEdits", destination: "session" },
            { type: "addDirectories", directories: ["/notes"], destination: "session" },
          ],
        } as unknown as Parameters<PermissionBridge["canUseTool"]>[2]);
        expect(captured!.options.find((o) => o.kind === "allow_always")?.description).toBe(
          "Covers all file edits, access to /notes until this chat ends. Start a new chat to undo."
        );
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

      it("asks the user before a Write or Edit to an agent's MEMORY.md, as for any other file, since saving a rule is the save_memory tool's job (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", async () => {
        const prompter = jest.fn(async (_prompt: PermissionPrompt) => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" as const },
        }));
        const bridge = new PermissionBridge("session-1", { getPrompter: () => prompter });
        const memoryPath = "/vault/copilot/teammates/coco/MEMORY.md";

        await bridge.canUseTool("Write", { file_path: memoryPath, content: "x" }, ctx);
        await bridge.canUseTool(
          "Edit",
          { file_path: memoryPath, old_string: "a", new_string: "b" },
          ctx
        );

        expect(prompter.mock.calls.map(([prompt]) => prompt.toolCall.kind)).toEqual([
          "edit",
          "edit",
        ]);
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

        describe("mode after the plan", () => {
          function makePlanBridge(optionId: string) {
            return new PermissionBridge("session-1", {
              getPrompter: () => async () => ({ outcome: { outcome: "selected", optionId } }),
              getModeAfterPlanApproval: () => "auto",
            });
          }

          it("switches Claude to the chosen mode for the session when the plan is approved (https://github.com/Brevilabs/obsidian-copilot-private/issues/958)", async () => {
            const result = await makePlanBridge("allow_once").canUseTool(
              "ExitPlanMode",
              { plan: "# x" },
              ctx
            );
            expect(result).toEqual({
              behavior: "allow",
              updatedInput: { plan: "# x" },
              updatedPermissions: [{ type: "setMode", mode: "auto", destination: "session" }],
            });
          });

          it("leaves the mode alone when the plan is rejected (https://github.com/Brevilabs/obsidian-copilot-private/issues/958)", async () => {
            const result = await makePlanBridge("reject_once").canUseTool(
              "ExitPlanMode",
              { plan: "# x" },
              ctx
            );
            expect(result).toEqual({ behavior: "deny", message: "User declined" });
          });

          it("leaves the mode alone when another tool is approved (https://github.com/Brevilabs/obsidian-copilot-private/issues/958)", async () => {
            const result = await makePlanBridge("allow_once").canUseTool(
              "Bash",
              { command: "ls" },
              ctx
            );
            expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
          });
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
