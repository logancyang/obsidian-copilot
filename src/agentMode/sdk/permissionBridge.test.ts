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
});
