import type { Stream } from "@agentclientprotocol/sdk";

interface ChildSession {
  root: string;
  parent: string;
  id: string;
  text: string;
  messageId?: string;
  terminal: boolean;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Owns child-session identity and display output, without controlling agent execution.
 * The draft lifecycle must be normalized before the released SDK validates notifications.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/467
 */
export class AcpSubagentRouter {
  private readonly children = new Map<string, ChildSession>();

  /** Forget a closed/reloaded root's tree, or all trees after the process exits. */
  clear(root?: string): void {
    for (const [id, child] of this.children) {
      if (root === undefined || child.root === root) this.children.delete(id);
    }
  }

  /**
   * Normalize draft lifecycle and child output into ordinary ACP tool notifications.
   * @param frame - One parsed JSON-RPC message, including unrelated requests/responses.
   */
  normalize(frame: unknown): unknown[] {
    const message = record(frame);
    const params = record(message?.params);
    // Child approvals use the existing root policy and UI, preserving RPC identity/options.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/467
    const requestingChild =
      typeof params?.sessionId === "string" ? this.children.get(params.sessionId) : undefined;
    if (message?.method === "session/request_permission" && requestingChild && params) {
      const tool = record(params.toolCall);
      return [
        {
          ...message,
          params: {
            ...params,
            sessionId: requestingChild.root,
            ...(tool
              ? { toolCall: childTool(tool, params.sessionId as string, requestingChild) }
              : {}),
          },
        },
      ];
    }
    const update = record(params?.update);
    if (message?.method !== "session/update" || typeof params?.sessionId !== "string" || !update)
      return [frame];
    const sessionId = params.sessionId;
    const parent = this.children.get(sessionId);
    const root = parent?.root ?? sessionId;
    const kind = update.sessionUpdate;
    const emit = (value: Record<string, unknown>) => [
      {
        ...message,
        params: { ...params, sessionId: root, update: value },
      },
    ];

    if (kind === "subagent_spawned") {
      const id = update.subagentSessionId;
      if (
        typeof id !== "string" ||
        !id ||
        id === root ||
        typeof update.name !== "string" ||
        typeof update.task !== "string" ||
        !record(update.capabilities) ||
        this.children.has(id) ||
        parent?.terminal
      )
        return [];
      const child = {
        root,
        parent: sessionId,
        id: `subagent:${JSON.stringify([root, id])}`,
        text: "",
        terminal: false,
      };
      this.children.set(id, child);
      return emit({
        sessionUpdate: "tool_call",
        toolCallId: child.id,
        title: update.name,
        kind: "other",
        status: "in_progress",
        rawInput: { task: update.task, description: update.name },
        _meta: { copilot: { subagent: "running", parentToolCallId: parent?.id } },
      });
    }
    if (kind === "subagent_state_update") {
      const child =
        typeof update.subagentSessionId === "string"
          ? this.children.get(update.subagentSessionId)
          : undefined;
      if (
        !child ||
        child.parent !== sessionId ||
        child.terminal ||
        !["completed", "failed", "cancelled", "disconnected"].includes(String(update.state))
      )
        return [];
      child.terminal = true;
      return emit({
        sessionUpdate: "tool_call_update",
        toolCallId: child.id,
        status: update.state === "completed" ? "completed" : "failed",
        // The root may have stopped while this child finished; its terminal snapshot
        // must carry the report even when interim display updates were suppressed.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/467
        content: child.text
          ? [{ type: "content", content: { type: "text", text: child.text } }]
          : undefined,
        _meta: { copilot: { subagent: update.state } },
      });
    }
    if (!parent) return [frame];
    // Child usage, plans and thoughts must never overwrite the root's state or prose.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/467
    if (parent.terminal) return [];
    if (kind === "agent_message_chunk") {
      const content = record(update.content);
      if (content?.type !== "text" || typeof content.text !== "string") return [];
      if (typeof update.messageId === "string") {
        if (parent.text && parent.messageId && parent.messageId !== update.messageId)
          parent.text += "\n\n";
        parent.messageId = update.messageId;
      }
      parent.text += content.text;
      return emit({
        sessionUpdate: "tool_call_update",
        toolCallId: parent.id,
        content: [{ type: "content", content: { type: "text", text: parent.text } }],
      });
    }
    if (
      (kind === "tool_call" || kind === "tool_call_update") &&
      typeof update.toolCallId === "string"
    ) {
      return emit(childTool(update, sessionId, parent));
    }
    return [];
  }

  /**
   * Keep ordinary ACP validation and permission handling on their existing path.
   * @param stream - The SDK's parsed stream, before ClientSideConnection validation.
   */
  wrap(stream: Stream): Stream {
    return {
      writable: stream.writable,
      readable: stream.readable.pipeThrough(
        new TransformStream({
          transform: (frame, controller) => {
            for (const value of this.normalize(frame)) controller.enqueue(value as typeof frame);
          },
        })
      ),
    };
  }
}

function childTool(
  update: Record<string, unknown>,
  sessionId: string,
  child: ChildSession
): Record<string, unknown> {
  return {
    ...update,
    toolCallId: `subagent-tool:${JSON.stringify([child.root, sessionId, update.toolCallId])}`,
    _meta: { ...record(update._meta), copilot: { parentToolCallId: child.id } },
  };
}
