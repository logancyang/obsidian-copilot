import { AgentSession } from "@/agentMode/session/AgentSession";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import type {
  BackendDescriptor,
  BackendProcess,
  PromptInput,
  PromptOutput,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import type { AgentTaskSubmission } from "@/agentMode/session/voiceTypes";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(() => ({ agentMode: {} })) }));

function makeSession(descriptor: BackendDescriptor | undefined = OpencodeBackendDescriptor) {
  let handler: SessionUpdateHandler | null = null;
  const prompts: { input: PromptInput; resolve: (output: PromptOutput) => void }[] = [];
  const cancel = jest.fn(async () => {});
  const backend = {
    registerSessionHandler: (_id: string, callback: SessionUpdateHandler) => {
      handler = callback;
      return () => {
        handler = null;
      };
    },
    prompt: (input: PromptInput) =>
      new Promise<PromptOutput>((resolve) => {
        prompts.push({ input, resolve });
      }),
    cancel,
    listSessions: async () => ({ sessions: [] }),
  } as unknown as BackendProcess;
  const session = new AgentSession({
    backend,
    backendSessionId: "opencode-session",
    internalId: "steering-session",
    backendId: "opencode",
    getDescriptor: () => descriptor,
  });
  return { session, prompts, cancel, emit: (event: SessionEvent) => handler?.(event) };
}

function submission(id: string, source: "typed" | "voice" = "typed"): AgentTaskSubmission {
  return {
    submissionId: id,
    conversationId: "steering-session",
    sourceMessageIds: [],
    source,
    presentation: source === "voice" ? "voice-card" : "text",
    requestText: id,
    ...(source === "voice" ? { voiceSessionId: "voice-session", delegationId: id } : {}),
  };
}

describe("AgentSession", () => {
  describe("AgentSession", () => {
    describe("tasks.submit()", () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it.each(["typed", "voice"] as const)(
        "interrupts OpenCode for a %s request and isolates cancelled output until the backend drains",
        async (source) => {
          const { session, prompts, cancel, emit } = makeSession();
          const first = session.tasks.submit(submission("read every note"));
          const next = session.tasks.submit(submission("read only the selected note", source));
          await jest.advanceTimersByTimeAsync(0);
          expect(cancel).toHaveBeenCalledWith({ sessionId: "opencode-session" });
          expect(session.store.getTask(first.taskId)?.state).toBe("cancelled");
          expect(prompts).toHaveLength(1);
          const chunk = (text: string, messageId: string) =>
            emit({
              sessionId: "opencode-session",
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId,
                content: { type: "text", text },
              },
            });
          chunk("stale output", "cancelled-message");
          prompts[0].resolve({ stopReason: "cancelled" });
          await jest.advanceTimersByTimeAsync(500);
          chunk("trailing output", "cancelled-message");
          await jest.advanceTimersByTimeAsync(500);
          expect(prompts).toHaveLength(1);
          await jest.advanceTimersByTimeAsync(1_000);
          expect(prompts).toHaveLength(2);
          expect(prompts[1].input.prompt).toContainEqual({
            type: "text",
            text: "read only the selected note",
          });
          chunk("late stale output", "cancelled-message");
          chunk("selected note summary", "replacement-message");
          prompts[1].resolve({ stopReason: "end_turn" });
          await jest.advanceTimersByTimeAsync(0);
          const task = session.store.getTask(next.taskId);
          expect(task?.state).toBe("completed");
          expect(session.store.getMessage(task?.assistantMessageId ?? "")?.message).toBe(
            "selected note summary"
          );
          await session.dispose();
        }
      );

      it("replaces a spoken task waiting for the cancelled OpenCode prompt to drain", async () => {
        const { session, prompts, cancel } = makeSession();
        session.tasks.submit(submission("first"));
        const obsolete = session.tasks.submit(submission("obsolete replacement", "voice"));
        await jest.advanceTimersByTimeAsync(0);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(session.tasks.getActiveTask()?.taskId).toBe(obsolete.taskId);
        const replacement = session.tasks.submit(submission("latest replacement", "voice"));
        await jest.advanceTimersByTimeAsync(0);
        expect(session.store.getTask(obsolete.taskId)?.state).toBe("cancelled");
        expect(prompts).toHaveLength(1);
        prompts[0].resolve({ stopReason: "cancelled" });
        await jest.advanceTimersByTimeAsync(1_000);
        expect(prompts).toHaveLength(2);
        expect(prompts[1].input.prompt).toContainEqual({
          type: "text",
          text: expect.stringContaining("<user-message>\nlatest replacement\n</user-message>"),
        });
        expect(session.tasks.getActiveTask()?.taskId).toBe(replacement.taskId);
        prompts[1].resolve({ stopReason: "end_turn" });
        await jest.advanceTimersByTimeAsync(0);
        await session.dispose();
      });

      it("denies an unanswered OpenCode permission before dispatching the replacement", async () => {
        const { session, prompts, cancel } = makeSession();
        session.tasks.submit(submission("edit a note"));
        const decision = session.handleToolPermission({
          sessionId: "opencode-session",
          toolCall: { toolCallId: "write-note", kind: "edit", status: "pending", title: "Write" },
          options: [
            { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
          ],
        });
        cancel.mockImplementation(async () => {
          await expect(decision).resolves.toEqual({
            outcome: { outcome: "selected", optionId: "reject_once" },
          });
          prompts[0].resolve({ stopReason: "cancelled" });
        });
        expect(session.getStatus()).toBe("awaiting_permission");
        const replacement = session.tasks.submit(submission("summarize instead", "voice"));
        await jest.advanceTimersByTimeAsync(1_000);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(session.getPendingToolPermissions()).toHaveLength(0);
        expect(prompts).toHaveLength(2);
        expect(session.tasks.getActiveTask()?.taskId).toBe(replacement.taskId);
        prompts[1].resolve({ stopReason: "end_turn" });
        await jest.advanceTimersByTimeAsync(0);
        await session.dispose();
      });

      it("keeps a backend without steering capability queued until its task completes", async () => {
        const { session, prompts, cancel } = makeSession({
          ...OpencodeBackendDescriptor,
          supportsSteering: false,
        });
        session.tasks.submit(submission("first"));
        session.tasks.submit(submission("second"));
        await jest.advanceTimersByTimeAsync(0);
        expect(cancel).not.toHaveBeenCalled();
        expect(prompts).toHaveLength(1);
        prompts[0].resolve({ stopReason: "end_turn" });
        await jest.advanceTimersByTimeAsync(0);
        expect(prompts).toHaveLength(2);
        prompts[1].resolve({ stopReason: "end_turn" });
        await jest.advanceTimersByTimeAsync(0);
        await session.dispose();
      });
    });
  });
});
