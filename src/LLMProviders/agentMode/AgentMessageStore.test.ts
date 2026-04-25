import { AI_SENDER } from "@/constants";
import { AgentMessagePart } from "@/LLMProviders/agentMode/types";
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
});
