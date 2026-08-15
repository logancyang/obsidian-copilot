import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk";
import type { PermissionOption } from "@/agentMode/session/types";
import { acpNotificationToEvents, acpPermissionRequestToPrompt } from "./wireTranslate";

const SESSION_ID = "sess-1";

function notification(update: Record<string, unknown>): SessionNotification {
  return { sessionId: SESSION_ID, update } as unknown as SessionNotification;
}

const VALID_TODOS = [
  { content: "Brainstorm autumn imagery", status: "in_progress", priority: "high" },
  { content: "Draft the haiku", status: "pending", priority: "high" },
  { content: "Review and polish", status: "pending", priority: "medium" },
];

const testAcpNotificationToEvents = () => {
  it("drops a user message chunk instead of reporting it as a titleless session update", () => {
    // A backend may echo the prompt on every live turn. Translating it would reach
    // the unknown-discriminant fallback, which reports a titleless session
    // update — and a backend whose titles are trusted then clears the label.
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "hi" },
      })
    );

    expect(events).toEqual([]);
  });

  it("appends a plan event after a todowrite tool_call carrying rawInput.todos", () => {
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "todowrite",
        kind: "other",
        status: "in_progress",
        rawInput: { todos: VALID_TODOS },
      })
    );
    expect(events).toHaveLength(2);
    expect(events[0].update.sessionUpdate).toBe("tool_call");
    expect(events[1].update).toEqual({
      sessionUpdate: "plan",
      entries: [
        { content: "Brainstorm autumn imagery", status: "in_progress", priority: "high" },
        { content: "Draft the haiku", status: "pending", priority: "high" },
        { content: "Review and polish", status: "pending", priority: "medium" },
      ],
    });
    expect(events.every((e) => e.sessionId === SESSION_ID)).toBe(true);
  });

  it("accepts a titleless tool_call_update once its id was registered as todowrite", () => {
    const ids = new Set<string>();
    acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "todowrite",
        rawInput: { todos: VALID_TODOS },
      }),
      ids
    );
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        rawInput: { todos: VALID_TODOS },
      }),
      ids
    );
    expect(events).toHaveLength(2);
    expect(events[1].update.sessionUpdate).toBe("plan");
  });

  it("rejects updates whose present title is not the native todowrite tool", () => {
    // Without a tracker, a renamed/foreign title is skipped (its predecessor
    // already delivered the same list).
    for (const title of ["3 todos", "bash", "mcp__tracker__todowrite"]) {
      const events = acpNotificationToEvents(
        notification({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          title,
          rawInput: { todos: VALID_TODOS },
        })
      );
      expect(events).toHaveLength(1);
    }
  });

  it("continues synthesizing for a renamed/titleless update once the id is registered", () => {
    const ids = new Set<string>();
    // First sight: titled `todowrite` registers the id and synthesizes.
    const first = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "call-7",
        title: "todowrite",
        rawInput: { todos: VALID_TODOS },
      }),
      ids
    );
    expect(first).toHaveLength(2);
    // Follow-up renamed "3 todos" for the SAME id still synthesizes.
    const renamed = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-7",
        title: "3 todos",
        rawInput: { todos: [{ content: "Brainstorm autumn imagery", status: "completed" }] },
      }),
      ids
    );
    expect(renamed).toHaveLength(2);
    expect(renamed[1].update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "Brainstorm autumn imagery", status: "completed", priority: "medium" }],
    });
  });

  it("does not synthesize for an unregistered id carrying a todos-shaped payload", () => {
    const ids = new Set<string>();
    // A foreign tool's titleless update with a todos field must not masquerade.
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "other-tool",
        rawInput: { todos: VALID_TODOS },
      }),
      ids
    );
    expect(events).toHaveLength(1);
  });

  it("ignores malformed todos and never appends for non-tool updates", () => {
    expect(
      acpNotificationToEvents(
        notification({
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "todowrite",
          rawInput: { todos: [{ content: "", status: "pending" }, { status: "in_progress" }, "x"] },
        })
      )
    ).toHaveLength(1);
    expect(
      acpNotificationToEvents(
        notification({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        })
      )
    ).toHaveLength(1);
  });

  it("emits an empty plan when a registered todo call reports todos: [] (a clear)", () => {
    const ids = new Set<string>();
    // First the list arrives, then the agent clears it with an empty array —
    // the synth must emit an empty plan so the snapshot resets downstream.
    acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "call-9",
        title: "todowrite",
        rawInput: { todos: VALID_TODOS },
      }),
      ids
    );
    const cleared = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-9",
        title: "0 todos",
        rawInput: { todos: [] },
      }),
      ids
    );
    expect(cleared).toHaveLength(2);
    expect(cleared[1].update).toEqual({ sessionUpdate: "plan", entries: [] });
  });

  it("passes a real plan notification through unchanged as a single event", () => {
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "plan",
        entries: [{ content: "step", status: "pending", priority: "medium" }],
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0].update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "step", status: "pending", priority: "medium" }],
    });
  });

  it("maps size→contextWindow and used→usedTokens, ignoring any cost", () => {
    const fixedNow = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const events = acpNotificationToEvents(
        notification({
          sessionUpdate: "usage_update",
          size: 200_000,
          used: 42_000,
          // cost is no longer part of the usage model — it must be dropped.
          cost: { amount: 0.1234, currency: "USD" },
        })
      );
      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe(SESSION_ID);
      expect(events[0].update).toEqual({
        sessionUpdate: "usage_update",
        usage: {
          usedTokens: 42_000,
          contextWindow: 200_000,
          updatedAt: fixedNow,
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
};

const testAcpPermissionRequestToPrompt = () => {
  function permissionRequest(metadata: unknown): RequestPermissionRequest {
    return {
      sessionId: SESSION_ID,
      toolCall: {
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "pending",
      },
      options: [
        {
          optionId: "opaque-option",
          name: "Allow",
          kind: "allow_always",
          _meta: metadata,
        },
      ],
    } as RequestPermissionRequest;
  }

  it("passes unchanged metadata to the presentation adapter", () => {
    const metadata = { codex: { decision: "accept" } };
    const presentPermissionOption = jest.fn((option: PermissionOption, _metadata: unknown) => ({
      ...option,
      name: "Allow Always",
    }));

    const prompt = acpPermissionRequestToPrompt(
      permissionRequest(metadata),
      presentPermissionOption
    );

    expect(presentPermissionOption).toHaveBeenCalledTimes(1);
    expect(presentPermissionOption.mock.calls[0][1]).toBe(metadata);
    expect(prompt.options).toEqual([
      {
        optionId: "opaque-option",
        name: "Allow Always",
        kind: "allow_always",
      },
    ]);
  });

  it("uses the wire option unchanged when no presentation adapter exists", () => {
    expect(acpPermissionRequestToPrompt(permissionRequest({ backend: "opaque" })).options).toEqual([
      {
        optionId: "opaque-option",
        name: "Allow",
        kind: "allow_always",
      },
    ]);
  });
};

describe("wireTranslate", () => {
  describe("acpNotificationToEvents()", testAcpNotificationToEvents);
  describe("acpPermissionRequestToPrompt()", testAcpPermissionRequestToPrompt);
});
