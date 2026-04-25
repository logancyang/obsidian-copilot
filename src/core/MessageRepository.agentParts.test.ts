import { AI_SENDER } from "@/constants";
import { AgentMessagePart } from "@/types/message";
import { formatDateTime } from "@/utils";
import { MessageRepository } from "./MessageRepository";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("MessageRepository agentParts mutators", () => {
  const placeholder = () => ({
    message: "",
    sender: AI_SENDER,
    timestamp: formatDateTime(new Date()),
    isVisible: true as const,
    agentParts: [] as AgentMessagePart[],
  });

  it("appendDisplayText accumulates streaming chunks", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.appendDisplayText(id, "Hello, ");
    repo.appendDisplayText(id, "world.");
    expect(repo.getMessage(id)?.message).toBe("Hello, world.");
  });

  it("appendDisplayText returns false for unknown message", () => {
    const repo = new MessageRepository();
    expect(repo.appendDisplayText("missing", "x")).toBe(false);
  });

  it("appendAgentThought folds successive chunks into one part", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.appendAgentThought(id, "Thinking");
    repo.appendAgentThought(id, " harder");
    const parts = repo.getMessage(id)?.agentParts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: "thought", text: "Thinking harder" });
  });

  it("upsertAgentPart appends new tool_call by toolCallId", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "pending",
    });
    const parts = repo.getMessage(id)?.agentParts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "tool_call", id: "tc1", title: "Read README" });
  });

  it("upsertAgentPart replaces existing tool_call when ids match", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "pending",
    });
    repo.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "completed",
      output: [{ type: "text", text: "ok" }],
    });
    const parts = repo.getMessage(id)?.agentParts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: "tool_call",
      id: "tc1",
      status: "completed",
      output: [{ type: "text", text: "ok" }],
    });
  });

  it("upsertAgentPart treats plan as singleton (replace, not duplicate)", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.upsertAgentPart(id, {
      kind: "plan",
      entries: [{ content: "step 1", priority: "high", status: "pending" }],
    });
    repo.upsertAgentPart(id, {
      kind: "plan",
      entries: [
        { content: "step 1", priority: "high", status: "completed" },
        { content: "step 2", priority: "medium", status: "pending" },
      ],
    });
    const parts = repo.getMessage(id)?.agentParts ?? [];
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

  it("getDisplayMessages includes agentParts", () => {
    const repo = new MessageRepository();
    const id = repo.addMessage(placeholder());
    repo.upsertAgentPart(id, {
      kind: "tool_call",
      id: "tc1",
      title: "x",
      status: "pending",
    });
    const msg = repo.getDisplayMessages().find((m) => m.id === id);
    expect(msg?.agentParts).toHaveLength(1);
  });
});
