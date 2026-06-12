import { AI_SENDER } from "@/constants";
import { AgentMessagePart } from "@/agentMode/session/types";
import { formatDateTime } from "@/utils";
import { AgentMessageStore } from "./AgentMessageStore";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("AgentMessageStore", () => {
  const placeholder = () => ({
    message: "",
    sender: AI_SENDER,
    timestamp: formatDateTime(new Date()),
    isVisible: true as const,
    parts: [] as AgentMessagePart[],
  });

  it("appendDisplayText accumulates streaming chunks", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.appendDisplayText(id, "Hello, ");
    store.appendDisplayText(id, "world.");
    expect(store.getMessage(id)?.message).toBe("Hello, world.");
  });

  it("appendDisplayText returns false for unknown message", () => {
    const store = new AgentMessageStore();
    expect(store.appendDisplayText("missing", "x")).toBe(false);
  });

  it("appendAgentText folds successive chunks into one trailing text part", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.appendAgentText(id, "Hello, ");
    store.appendAgentText(id, "world.");
    const msg = store.getMessage(id);
    const parts = msg?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: "text", text: "Hello, world." });
    // Flat body stays in sync for persistence / search / error append.
    expect(msg?.message).toBe("Hello, world.");
  });

  it("appendAgentText starts a new text part when interrupted by a tool call", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.appendAgentText(id, "before");
    store.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "completed",
    });
    store.appendAgentText(id, "after");
    const parts = store.getMessage(id)?.parts ?? [];
    expect(parts.map((p) => p.kind)).toEqual(["text", "tool_call", "text"]);
    expect(parts[0]).toEqual({ kind: "text", text: "before" });
    expect(parts[2]).toEqual({ kind: "text", text: "after" });
  });

  it("appendAgentText returns false for unknown message", () => {
    const store = new AgentMessageStore();
    expect(store.appendAgentText("missing", "x")).toBe(false);
  });

  it("appendAgentThought folds successive chunks into one part", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.appendAgentThought(id, "Thinking");
    store.appendAgentThought(id, " harder");
    const parts = store.getMessage(id)?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: "thought", text: "Thinking harder" });
  });

  it("upsertAgentPart appends new tool_call by toolCallId", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "pending",
    });
    const parts = store.getMessage(id)?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "tool_call", id: "tc1", title: "Read README" });
  });

  it("upsertAgentPart replaces existing tool_call when ids match", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "pending",
    });
    store.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "completed",
      output: [{ type: "text", text: "ok" }],
    });
    const parts = store.getMessage(id)?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: "tool_call",
      id: "tc1",
      status: "completed",
      output: [{ type: "text", text: "ok" }],
    });
  });

  it("upsertAgentPart returns false when re-applying an identical snapshot", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    const part: AgentMessagePart = {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "pending",
    };
    expect(store.upsertAgentPart(id, part)).toBe(true);
    expect(store.upsertAgentPart(id, { ...part })).toBe(false);
  });

  it("upsertAgentPart compares large repeated tool outputs without duplicating", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    const part: AgentMessagePart = {
      kind: "tool_call",
      id: "tc1",
      title: "Search",
      status: "completed",
      input: { query: "communication drill", nested: { text: "x".repeat(20_000) } },
      output: [{ type: "text", text: "a".repeat(20_000) }],
    };

    expect(store.upsertAgentPart(id, part)).toBe(true);
    expect(
      store.upsertAgentPart(id, { ...part, output: part.output?.map((o) => ({ ...o })) })
    ).toBe(false);
    expect(store.getMessage(id)?.parts).toHaveLength(1);
  });

  it("upsertAgentPart treats plan as singleton (replace, not duplicate)", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.upsertAgentPart(id, {
      kind: "plan",
      entries: [{ content: "step 1", priority: "high", status: "pending" }],
    });
    store.upsertAgentPart(id, {
      kind: "plan",
      entries: [
        { content: "step 1", priority: "high", status: "completed" },
        { content: "step 2", priority: "medium", status: "pending" },
      ],
    });
    const parts = store.getMessage(id)?.parts ?? [];
    const planParts = parts.filter((p) => p.kind === "plan");
    expect(planParts).toHaveLength(1);
    expect(planParts[0]).toMatchObject({
      kind: "plan",
      entries: expect.arrayContaining([
        expect.objectContaining({ content: "step 1", status: "completed" }),
        expect.objectContaining({ content: "step 2" }),
      ]),
    });
  });

  it("getDisplayMessages includes parts", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage(placeholder());
    store.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "x",
      status: "pending",
    });
    const msg = store.getDisplayMessages().find((m) => m.id === id);
    expect(msg?.parts).toHaveLength(1);
  });

  it("markMessageError flags the message and appends formatted error text", () => {
    const store = new AgentMessageStore();
    const id = store.addMessage({
      message: "partial reply",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
    });
    store.markMessageError(id, "boom");
    const msg = store.getMessage(id);
    expect(msg?.isErrorMessage).toBe(true);
    expect(msg?.message).toContain("partial reply");
    expect(msg?.message).toContain("**Error:** boom");
  });

  it("truncateAfterMessageId drops everything after the target", () => {
    const store = new AgentMessageStore();
    const a = store.addMessage(placeholder());
    store.addMessage(placeholder());
    store.addMessage(placeholder());
    store.truncateAfterMessageId(a);
    expect(store.getDisplayMessages()).toHaveLength(1);
  });

  describe("getDisplayMessages memoization (streaming re-render coalescing)", () => {
    it("returns the same array reference when nothing changed", () => {
      const store = new AgentMessageStore();
      store.addMessage(placeholder());
      const first = store.getDisplayMessages();
      const second = store.getDisplayMessages();
      // An idle subscription tick (no mutation) must hand back the exact same
      // array so the top-level `messages` memo bails out without diffing.
      expect(second).toBe(first);
    });

    it("keeps stable identities for unchanged messages while one streams", () => {
      const store = new AgentMessageStore();
      const stable = store.addMessage({
        message: "done",
        sender: AI_SENDER,
        timestamp: formatDateTime(new Date()),
        isVisible: true,
      });
      const streaming = store.addMessage(placeholder());

      const before = store.getDisplayMessages();
      const stableBefore = before.find((m) => m.id === stable);
      const streamingBefore = before.find((m) => m.id === streaming);

      // Stream a token into only the second message.
      store.appendAgentText(streaming, "Hello");

      const after = store.getDisplayMessages();
      const stableAfter = after.find((m) => m.id === stable);
      const streamingAfter = after.find((m) => m.id === streaming);

      // The array is rebuilt (something changed)...
      expect(after).not.toBe(before);
      // ...but the untouched message keeps its identity so its memoized React
      // component skips re-rendering...
      expect(stableAfter).toBe(stableBefore);
      // ...while the streamed message gets a fresh object reflecting the new text.
      expect(streamingAfter).not.toBe(streamingBefore);
      expect(streamingAfter?.message).toBe("Hello");
    });

    it("re-adapts a message after every kind of in-place mutation", () => {
      const store = new AgentMessageStore();
      const id = store.addMessage(placeholder());

      const v0 = store.getDisplayMessages()[0];
      store.appendDisplayText(id, "x");
      const v1 = store.getDisplayMessages()[0];
      expect(v1).not.toBe(v0);

      store.upsertAgentPart(id, { kind: "tool_call", id: "tc1", title: "t", status: "pending" });
      const v2 = store.getDisplayMessages()[0];
      expect(v2).not.toBe(v1);

      store.markTurnComplete(id, "end_turn", 10);
      const v3 = store.getDisplayMessages()[0];
      expect(v3).not.toBe(v2);
      expect(v3.turnStopReason).toBe("end_turn");
    });

    it("does not re-adapt when upsertAgentPart is a no-op", () => {
      const store = new AgentMessageStore();
      const id = store.addMessage(placeholder());
      const part: AgentMessagePart = {
        kind: "tool_call",
        id: "tc1",
        title: "Read README",
        status: "pending",
      };
      store.upsertAgentPart(id, part);
      const before = store.getDisplayMessages()[0];
      // Re-applying an identical snapshot is a no-op, so the cached view must
      // survive — no spurious identity churn for the React tree.
      expect(store.upsertAgentPart(id, { ...part })).toBe(false);
      const after = store.getDisplayMessages()[0];
      expect(after).toBe(before);
    });

    it("drops cached views for deleted and truncated messages", () => {
      const store = new AgentMessageStore();
      const a = store.addMessage(placeholder());
      const b = store.addMessage(placeholder());
      store.getDisplayMessages();

      store.deleteMessage(b);
      expect(store.getDisplayMessages().map((m) => m.id)).toEqual([a]);

      const c = store.addMessage(placeholder());
      store.truncateAfterMessageId(a);
      expect(store.getDisplayMessages().map((m) => m.id)).toEqual([a]);
      expect(store.getMessage(c)).toBeUndefined();
    });
  });
});
