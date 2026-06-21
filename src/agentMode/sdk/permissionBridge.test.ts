import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { PermissionBridge, type AskUserQuestionPrompter } from "./permissionBridge";

describe("PermissionBridge.canUseTool", () => {
  function makeBridge(
    prompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null,
    askUserQuestionPrompter?: AskUserQuestionPrompter
  ) {
    const bridge = new PermissionBridge({
      getPrompter: () => prompter,
      getAskUserQuestionPrompter: askUserQuestionPrompter
        ? () => askUserQuestionPrompter
        : undefined,
    });
    bridge.setSessionContext("session-1");
    return bridge;
  }

  /**
   * Minimal stand-in for an `AgentSession`'s ask-question resolver path: holds
   * the in-flight request and a `resolve` handle so a test can drive the
   * inline-card "submit" / "cancel" transitions the bridge awaits.
   */
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

  it("denies when no prompter is registered", async () => {
    const bridge = new PermissionBridge({ getPrompter: () => null });
    bridge.setSessionContext("session-1");
    const result = await bridge.canUseTool("Edit", { file_path: "a.md" }, ctx);
    expect(result.behavior).toBe("deny");
  });

  it("synthesizes a PermissionPrompt with kind from toolName", async () => {
    let captured: PermissionPrompt | null = null;
    const bridge = makeBridge(async (req) => {
      captured = req;
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });
    await bridge.canUseTool("Edit", { file_path: "a.md" }, ctx);
    expect(captured).not.toBeNull();
    expect(captured!.toolCall.kind).toBe("edit");
    expect(captured!.toolCall.rawInput).toEqual({ file_path: "a.md" });
    expect(captured!.options.map((o) => o.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
      "reject_always",
    ]);
  });

  it("propagates ctx.toolUseID as PermissionPrompt.toolCall.toolCallId", async () => {
    // The trail UI pairs each permission prompt with the corresponding
    // `tool_call` notification by id. If the bridge mints a fresh uuid
    // here instead of reusing the SDK's `tool_use_id`, the prompt and the
    // notification disagree and the action card cannot be resolved.
    let captured: PermissionPrompt | null = null;
    const bridge = makeBridge(async (req) => {
      captured = req;
      return { outcome: { outcome: "selected", optionId: "reject_once" } };
    });
    const ctxWithToolUse = {
      signal: new AbortController().signal,
      toolUseID: "toolu_abc123",
    } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];
    await bridge.canUseTool("Edit", { file_path: "a.md" }, ctxWithToolUse);
    expect(captured).not.toBeNull();
    expect(captured!.toolCall.toolCallId).toBe("toolu_abc123");
  });

  it("maps allow_once to allow with updatedInput echoing the original input", async () => {
    const bridge = makeBridge(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("maps allow_always with suggestions to allow + updatedInput + updatedPermissions", async () => {
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

  it("maps reject_once to deny with a message", async () => {
    const bridge = makeBridge(async () => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
    expect(result.behavior).toBe("deny");
    if (result.behavior === "deny") expect(result.message).toContain("declined");
  });

  it("forwards decision.denyMessage as the deny message on reject", async () => {
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

  it("ignores denyMessage when the decision is allow", async () => {
    const bridge = makeBridge(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
      denyMessage: "this should be ignored",
    }));
    const result = await bridge.canUseTool("Bash", { command: "ls" }, ctx);
    expect(result.behavior).toBe("allow");
  });

  it("maps cancelled outcome to deny", async () => {
    const bridge = makeBridge(async () => ({ outcome: { outcome: "cancelled" } }));
    const result = await bridge.canUseTool("Bash", {}, ctx);
    expect(result.behavior).toBe("deny");
  });

  it("routes AskUserQuestion to the ask-question prompter with a session-domain request", async () => {
    const handler = jest.fn<Promise<AgentQuestionAnswers>, [AskUserQuestionPrompt]>(async () => ({
      "What's your favorite color?": "Blue",
    }));
    const bridge = makeBridge(null, handler);
    const result = await bridge.canUseTool(
      "AskUserQuestion",
      {
        questions: [{ question: "What's your favorite color?", options: [{ label: "Blue" }] }],
      },
      ctx
    );
    expect(handler).toHaveBeenCalledWith({
      sessionId: "session-1",
      requestId: "toolu_test_id",
      questions: [{ question: "What's your favorite color?", options: [{ label: "Blue" }] }],
    });
    expect(result.behavior).toBe("allow");
    if (result.behavior === "allow") {
      expect(result.updatedInput).toMatchObject({
        answers: { "What's your favorite color?": "Blue" },
      });
    }
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

  it("submitting answers resolves AskUserQuestion with allow + the { questions, answers } payload", async () => {
    // End-to-end inline-card resolver path: the bridge awaits the session's
    // pending question, then maps the submitted answers back to a SDK allow —
    // the same payload the old modal produced.
    const fake = new FakeQuestionSession();
    const bridge = makeBridge(null, fake.handle);
    const questions = [
      { question: "Pick a fruit", options: [{ label: "Apple" }, { label: "Pear" }] },
    ];
    const resultPromise = bridge.canUseTool("AskUserQuestion", { questions }, ctx);
    // The card is pending until the user submits — the prompter saw the
    // session-domain request keyed by the SDK tool_use_id.
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

  it("cancelling AskUserQuestion (empty answers) resolves with deny + the cancellation message", async () => {
    const fake = new FakeQuestionSession();
    const bridge = makeBridge(null, fake.handle);
    const resultPromise = bridge.canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Q", options: [{ label: "A" }] }] },
      ctx
    );

    // Dismissing the card resolves the resolver with `{}`.
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
      const bridge = new PermissionBridge({
        getPrompter: () => prompter,
        isPlanModePlanFilePath,
      });
      bridge.setSessionContext("session-1");
      return bridge;
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
      const bridge = new PermissionBridge({ getPrompter: () => prompter });
      bridge.setSessionContext("session-1");
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
      const bridge = new PermissionBridge({
        getPrompter: () => prompter,
        isPlanModePlanFilePath: planMatcher,
        // The current session is a read-only fan-out sub-session.
        getIsReadOnlySession: () => () => true,
      });
      bridge.setSessionContext("session-1");

      const result = await bridge.canUseTool(
        "Write",
        { file_path: "/Users/x/.claude/plans/foo.md", content: "# plan" },
        ctx
      );

      // The read-only deny fires first: the plan-file auto-allow never runs and
      // the prompter is never consulted.
      expect(result.behavior).toBe("deny");
      if (result.behavior === "deny") {
        expect(result.message).toContain("Read-only QA turn");
      }
      expect(planMatcher).not.toHaveBeenCalled();
      expect(prompter).not.toHaveBeenCalled();
    });

    it("still allows reads in a read-only session (only write/exec are denied)", async () => {
      const prompter = jest.fn(async () => ({
        outcome: { outcome: "selected" as const, optionId: "allow_once" as const },
      }));
      const bridge = new PermissionBridge({
        getPrompter: () => prompter,
        getIsReadOnlySession: () => () => true,
      });
      bridge.setSessionContext("session-1");

      const result = await bridge.canUseTool("Read", { file_path: "/tmp/a.md" }, ctx);
      // A read tool falls through to the normal prompter path.
      expect(prompter).toHaveBeenCalled();
      expect(result.behavior).toBe("allow");
    });

    it("denies an UNKNOWN MCP tool (kind 'other') in a read-only session — fail safe", async () => {
      const prompter = jest.fn();
      const bridge = new PermissionBridge({
        getPrompter: () => prompter,
        getIsReadOnlySession: () => () => true,
      });
      bridge.setSessionContext("session-1");

      // A third-party MCP tool whose name isn't a known built-in derives to
      // `other`; it can't be verified read-only, so the gate must deny it.
      const result = await bridge.canUseTool("mcp__notion__create_page", { title: "x" }, ctx);
      expect(result.behavior).toBe("deny");
      expect(prompter).not.toHaveBeenCalled();
    });

    it("does not gate writes when the session is NOT read-only (plan auto-allow still applies)", async () => {
      const prompter = jest.fn();
      const bridge = new PermissionBridge({
        getPrompter: () => prompter,
        isPlanModePlanFilePath: (p) => p.endsWith("/.claude/plans/foo.md"),
        getIsReadOnlySession: () => () => false,
      });
      bridge.setSessionContext("session-1");

      const result = await bridge.canUseTool(
        "Write",
        { file_path: "/Users/x/.claude/plans/foo.md", content: "# plan" },
        ctx
      );
      // Not read-only → the plan-file auto-allow proceeds as before.
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
