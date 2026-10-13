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
  it("translates a user message chunk into a user_message_chunk event carrying its text and message id", () => {
    const events = acpNotificationToEvents(
      notification({
        sessionUpdate: "user_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: "hi" },
      })
    );

    expect(events).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "hi" },
          messageId: "msg-1",
        },
      },
    ]);
  });

  it.each([
    ["plan_update", { plan: { type: "markdown", planId: "plan-1", content: "# Plan" } }],
    ["plan_removed", { planId: "plan-1" }],
  ])(
    "drops a %s so the plan-approval card stays the only place a proposed plan renders (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)",
    (sessionUpdate, fields) => {
      expect(acpNotificationToEvents(notification({ sessionUpdate, ...fields }))).toEqual([]);
    }
  );

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

  it("attaches the file texts Copilot's OpenCode plugin recorded before a tool wrote them https://github.com/Brevilabs/obsidian-copilot-private/issues/687", () => {
    const originalFiles = { "/vault/a.md": "before\n", "/vault/new.md": null };

    const [event] = acpNotificationToEvents(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        rawOutput: { metadata: { files: [], copilot: { originalFiles } } },
      })
    );

    expect(event.update).toMatchObject({ originalFiles });
  });

  it("attaches no file texts when a tool result has none or they are not text", () => {
    const toolResult = (rawOutput: unknown) =>
      acpNotificationToEvents(
        notification({ sessionUpdate: "tool_call_update", toolCallId: "call-1", rawOutput })
      )[0].update;

    expect(toolResult(undefined)).not.toHaveProperty("originalFiles");
    expect(toolResult({ metadata: { files: [] } })).not.toHaveProperty("originalFiles");
    expect(
      toolResult({ metadata: { copilot: { originalFiles: { "/vault/a.md": 42 } } } })
    ).not.toHaveProperty("originalFiles");
  });

  it.each([
    ["available_commands_update", { availableCommands: [] }],
    ["notice", { message: "retrying" }],
  ])(
    "emits no event for an unmapped %s update so it cannot clear an agent-generated title (https://github.com/Brevilabs/obsidian-copilot-private/issues/632)",
    (sessionUpdate, fields) => {
      expect(acpNotificationToEvents(notification({ sessionUpdate, ...fields }))).toEqual([]);
    }
  );

  it("maps a session_info_update carrying a title to a title event", () => {
    expect(
      acpNotificationToEvents(notification({ sessionUpdate: "session_info_update", title: "x" }))
    ).toEqual([
      { sessionId: SESSION_ID, update: { sessionUpdate: "session_info_update", title: "x" } },
    ]);
  });

  it("maps a session_info_update with an explicit null title to a title-clearing event (https://github.com/Brevilabs/obsidian-copilot-private/issues/632)", () => {
    expect(
      acpNotificationToEvents(notification({ sessionUpdate: "session_info_update", title: null }))
    ).toEqual([
      { sessionId: SESSION_ID, update: { sessionUpdate: "session_info_update", title: null } },
    ]);
  });

  it("maps a session_info_update without a title, such as an opencode compaction marker, to an event that omits the title so the chat title survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/632)", () => {
    const [event] = acpNotificationToEvents(
      notification({
        sessionUpdate: "session_info_update",
        _meta: { opencode: { compaction: { phase: "started" } } },
      })
    );
    expect(event.update).toEqual({ sessionUpdate: "session_info_update" });
  });

  it.each(["in_progress", "completed", "failed", "cancelled"])(
    "maps a %s compaction_update to a compaction event keyed by its compactionId (https://github.com/Brevilabs/obsidian-copilot-private/issues/636)",
    (status) => {
      expect(
        acpNotificationToEvents(
          notification({ sessionUpdate: "compaction_update", compactionId: "cmp-1", status })
        )
      ).toEqual([
        {
          sessionId: SESSION_ID,
          update: { sessionUpdate: "compaction", id: "cmp-1", status, trigger: "auto" },
        },
      ]);
    }
  );

  it("passes a failed compaction_update's error through to the compaction event", () => {
    expect(
      acpNotificationToEvents(
        notification({
          sessionUpdate: "compaction_update",
          compactionId: "cmp-1",
          status: "failed",
          error: "context too large",
        })
      )
    ).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "compaction",
          id: "cmp-1",
          status: "failed",
          trigger: "auto",
          error: "context too large",
        },
      },
    ]);
  });

  it("labels a compaction_update with the trigger the caller supplies", () => {
    const [event] = acpNotificationToEvents(
      notification({
        sessionUpdate: "compaction_update",
        compactionId: "cmp-1",
        status: "in_progress",
      }),
      undefined,
      "manual"
    );

    expect(event.update).toMatchObject({ sessionUpdate: "compaction", trigger: "manual" });
  });

  it("emits no event for a compaction_update with an unknown status because the status set is open (https://github.com/Brevilabs/obsidian-copilot-private/issues/636)", () => {
    expect(
      acpNotificationToEvents(
        notification({
          sessionUpdate: "compaction_update",
          compactionId: "cmp-1",
          status: "paused",
        })
      )
    ).toEqual([]);
  });

  it("emits no event for a compaction_summary_chunk because the compaction row shows no summary text (https://github.com/Brevilabs/obsidian-copilot-private/issues/636)", () => {
    expect(
      acpNotificationToEvents(
        notification({
          sessionUpdate: "compaction_summary_chunk",
          compactionId: "cmp-1",
          content: { type: "text", text: "summary" },
        })
      )
    ).toEqual([]);
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
