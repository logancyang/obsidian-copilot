import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { PermissionBridge } from "./permissionBridge";

describe("PermissionBridge.canUseTool", () => {
  function makeBridge(
    prompter: ((req: RequestPermissionRequest) => Promise<RequestPermissionResponse>) | null,
    askUserQuestion?: (
      questions: Array<{ question: string; options: Array<{ label: string }> }>
    ) => Promise<{ [q: string]: string }>
  ) {
    const bridge = new PermissionBridge({
      getPrompter: () => prompter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      askUserQuestion: askUserQuestion as any,
    });
    bridge.setSessionContext("session-1");
    return bridge;
  }

  const ctx = {
    signal: new AbortController().signal,
    toolUseID: "toolu_test_id",
  } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];

  it("denies when no prompter is registered", async () => {
    const bridge = new PermissionBridge({ getPrompter: () => null });
    bridge.setSessionContext("session-1");
    const result = await bridge.canUseTool("vault_edit", { path: "a.md" }, ctx);
    expect(result.behavior).toBe("deny");
  });

  it("synthesizes a RequestPermissionRequest with kind from toolName", async () => {
    let captured: RequestPermissionRequest | null = null;
    const bridge = makeBridge(async (req) => {
      captured = req;
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });
    await bridge.canUseTool("vault_edit", { path: "a.md" }, ctx);
    expect(captured).not.toBeNull();
    expect(captured!.toolCall.kind).toBe("edit");
    expect(captured!.toolCall.rawInput).toEqual({ path: "a.md" });
    expect(captured!.options.map((o) => o.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
      "reject_always",
    ]);
  });

  it("propagates ctx.toolUseID as RequestPermissionRequest.toolCall.toolCallId", async () => {
    // The session layer keys plan-card resolvers off the `tool_call`
    // notification's `toolCallId` (the SDK's `tool_use_id`). If the bridge
    // mints a fresh uuid here instead, rejecting a plan card cannot find the
    // resolver — the SDK's `canUseTool` promise never settles and the chat
    // hangs. Pin the propagation contract.
    let captured: RequestPermissionRequest | null = null;
    const bridge = makeBridge(async (req) => {
      captured = req;
      return { outcome: { outcome: "selected", optionId: "reject_once" } };
    });
    const ctxWithToolUse = {
      signal: new AbortController().signal,
      toolUseID: "toolu_abc123",
    } as unknown as Parameters<PermissionBridge["canUseTool"]>[2];
    await bridge.canUseTool("ExitPlanMode", { plan: "# x" }, ctxWithToolUse);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          type: "addRules",
          rules: [{ toolName: "Bash" }],
          behavior: "allow",
          destination: "session",
        } as any,
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

  it("maps cancelled outcome to deny", async () => {
    const bridge = makeBridge(async () => ({ outcome: { outcome: "cancelled" } }));
    const result = await bridge.canUseTool("Bash", {}, ctx);
    expect(result.behavior).toBe("deny");
  });

  it("routes AskUserQuestion to the dedicated handler with answers", async () => {
    const handler = jest.fn(async () => ({ "What's your favorite color?": "Blue" }));
    const bridge = makeBridge(null, handler);
    const result = await bridge.canUseTool(
      "AskUserQuestion",
      {
        questions: [{ question: "What's your favorite color?", options: [{ label: "Blue" }] }],
      },
      ctx
    );
    expect(handler).toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
    if (result.behavior === "allow") {
      expect(result.updatedInput).toMatchObject({
        answers: { "What's your favorite color?": "Blue" },
      });
    }
  });

  it("denies AskUserQuestion when no handler is configured", async () => {
    const bridge = makeBridge(async () => ({ outcome: { outcome: "cancelled" } }));
    const result = await bridge.canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Q", options: [{ label: "A" }] }] },
      ctx
    );
    expect(result.behavior).toBe("deny");
  });

  it("treats empty AskUserQuestion answers as cancelled", async () => {
    const handler = jest.fn(async () => ({}));
    const bridge = makeBridge(null, handler);
    const result = await bridge.canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Q", options: [{ label: "A" }] }] },
      ctx
    );
    expect(result.behavior).toBe("deny");
  });

  describe("Write tool gating", () => {
    function makeBridgeWithPlanMatcher(
      isPlanModePlanFilePath: (p: string) => boolean,
      prompter:
        | ((req: RequestPermissionRequest) => Promise<RequestPermissionResponse>)
        | null = null
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
        prompter as unknown as Parameters<typeof makeBridgeWithPlanMatcher>[1]
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

    it("denies Write to non-plan paths without prompting", async () => {
      const prompter = jest.fn();
      const bridge = makeBridgeWithPlanMatcher(
        () => false,
        prompter as unknown as Parameters<typeof makeBridgeWithPlanMatcher>[1]
      );
      const result = await bridge.canUseTool(
        "Write",
        { file_path: "/tmp/foo.md", content: "x" },
        ctx
      );
      expect(result.behavior).toBe("deny");
      if (result.behavior === "deny") {
        expect(result.message).toContain("plan-mode");
      }
      expect(prompter).not.toHaveBeenCalled();
    });

    it("denies Write with missing file_path", async () => {
      const bridge = makeBridgeWithPlanMatcher(() => true);
      const result = await bridge.canUseTool("Write", { content: "x" }, ctx);
      expect(result.behavior).toBe("deny");
      if (result.behavior === "deny") {
        expect(result.message).toContain("file_path");
      }
    });

    it("denies Write when no plan predicate is configured", async () => {
      const bridge = new PermissionBridge({ getPrompter: () => null });
      bridge.setSessionContext("session-1");
      const result = await bridge.canUseTool(
        "Write",
        { file_path: "/Users/x/.claude/plans/foo.md", content: "x" },
        ctx
      );
      expect(result.behavior).toBe("deny");
    });
  });
});
