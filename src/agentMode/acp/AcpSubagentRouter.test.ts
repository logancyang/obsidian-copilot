import { execFileSync } from "child_process";
import { AcpSubagentRouter } from "./AcpSubagentRouter";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/467";
const frame = (sessionId: string, update: Record<string, unknown>) => ({
  jsonrpc: "2.0" as const,
  method: "session/update",
  params: { sessionId, update },
});
const spawn = (sessionId: string, child: string, task = "Read the fixtures") =>
  frame(sessionId, {
    sessionUpdate: "subagent_spawned",
    subagentSessionId: child,
    name: "Reader",
    task,
    capabilities: {},
  });
const params = (result: unknown[]) =>
  (
    result[0] as {
      params: {
        sessionId: string;
        update: {
          sessionUpdate: string;
          toolCallId: string;
          status?: string;
          _meta: { copilot: { parentToolCallId?: string; subagent?: string } };
        };
      };
    }
  ).params;

describe("AcpSubagentRouter", () => {
  describe("AcpSubagentRouter", () => {
    describe("normalize()", () => {
      it(`turns a native launch into an SDK-valid expandable tool with its task description (${ISSUE})`, () => {
        const result = new AcpSubagentRouter().normalize(spawn("root", "child"));
        expect(params(result)).toMatchObject({
          sessionId: "root",
          update: {
            sessionUpdate: "tool_call",
            rawInput: { task: "Read the fixtures" },
            _meta: { copilot: { subagent: "running" } },
          },
        });
        const accepted = execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
          import { zSessionNotification } from './node_modules/@agentclientprotocol/sdk/dist/schema/zod.gen.js';
          import fs from 'node:fs';
          const frames = JSON.parse(fs.readFileSync(0, 'utf8'));
          process.stdout.write(JSON.stringify(frames.every(f => zSessionNotification.safeParse(f.params).success)));
        `,
          ],
          { cwd: process.cwd(), input: JSON.stringify(result), encoding: "utf8" }
        );
        expect(accepted).toBe("true");
      });

      it(`keeps concurrent child tools with reused ids and their reports on separate launches (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        const alpha = params(router.normalize(spawn("root", "alpha"))).update.toolCallId;
        const beta = params(router.normalize(spawn("root", "beta"))).update.toolCallId;
        const tool = {
          sessionUpdate: "tool_call",
          toolCallId: "read",
          title: "Read note",
          status: "in_progress",
        };
        const a = params(router.normalize(frame("alpha", tool)));
        const b = params(router.normalize(frame("beta", tool)));
        expect(a.sessionId).toBe("root");
        expect(a.update._meta.copilot.parentToolCallId).toBe(alpha);
        expect(b.update._meta.copilot.parentToolCallId).toBe(beta);
        expect(a.update.toolCallId).not.toBe(b.update.toolCallId);
        const chunk = (text: string) => ({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        });
        router.normalize(frame("alpha", chunk("Alpha ")));
        expect(params(router.normalize(frame("beta", chunk("Beta report")))).update).toMatchObject({
          toolCallId: beta,
          content: [{ content: { text: "Beta report" } }],
        });
        expect(params(router.normalize(frame("alpha", chunk("report")))).update).toMatchObject({
          toolCallId: alpha,
          content: [{ content: { text: "Alpha report" } }],
        });
      });

      it(`routes child approval through its root policy with stable tool and request identity (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        const parent = params(router.normalize(spawn("root", "child"))).update.toolCallId;
        const toolCall = { toolCallId: "read", title: "Read note", status: "pending" };
        const toolId = params(
          router.normalize(frame("child", { ...toolCall, sessionUpdate: "tool_call" }))
        ).update.toolCallId;
        const request = {
          jsonrpc: "2.0",
          id: 42,
          method: "session/request_permission",
          params: {
            sessionId: "child",
            toolCall,
            options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
          },
        };
        expect(router.normalize(request)).toEqual([
          {
            ...request,
            params: {
              ...request.params,
              sessionId: "root",
              toolCall: {
                ...toolCall,
                toolCallId: toolId,
                _meta: { copilot: { parentToolCallId: parent } },
              },
            },
          },
        ]);
      });

      it(`joins chunks within a child message and separates its commentary from a later report (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        router.normalize(spawn("root", "child"));
        const update = (messageId: string, text: string) =>
          frame("child", {
            sessionUpdate: "agent_message_chunk",
            messageId,
            content: { type: "text", text },
          });
        router.normalize(update("commentary", "I will "));
        router.normalize(update("commentary", "read the note."));
        expect(
          params(router.normalize(update("answer", "The fixture is complete."))).update
        ).toMatchObject({
          content: [{ content: { text: "I will read the note.\n\nThe fixture is complete." } }],
        });
      });

      it.each(["completed", "failed", "cancelled", "disconnected"])(
        `retains the reported %s outcome without accepting later child activity (${ISSUE})`,
        (state) => {
          const router = new AcpSubagentRouter();
          router.normalize(spawn("root", "child"));
          router.normalize(
            frame("child", {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Emitted child report" },
            })
          );
          const update = params(
            router.normalize(
              frame("root", {
                sessionUpdate: "subagent_state_update",
                subagentSessionId: "child",
                state,
              })
            )
          ).update;
          expect(update.status).toBe(state === "completed" ? "completed" : "failed");
          expect(update._meta.copilot.subagent).toBe(state);
          expect(update).toMatchObject({
            content: [{ content: { text: "Emitted child report" } }],
          });
          expect(
            router.normalize(
              frame("child", {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "late" },
              })
            )
          ).toEqual([]);
        }
      );

      it(`groups nested children by their immediate parent and keeps resumed generations distinct (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        const first = params(router.normalize(spawn("root", "child"))).update.toolCallId;
        expect(params(router.normalize(spawn("child", "grandchild")))).toMatchObject({
          sessionId: "root",
          update: { _meta: { copilot: { parentToolCallId: first } } },
        });
        router.normalize(
          frame("root", {
            sessionUpdate: "subagent_state_update",
            subagentSessionId: "child",
            state: "completed",
          })
        );
        const resumed = params(router.normalize(spawn("root", "child:generation:2"))).update
          .toolCallId;
        expect(resumed).not.toBe(first);
        expect(router.normalize(spawn("root", "child"))).toEqual([]);
      });

      it(`does not mix child reasoning, plans or usage into the root and preserves requests (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        router.normalize(spawn("root", "child"));
        for (const sessionUpdate of [
          "agent_thought_chunk",
          "plan",
          "usage_update",
          "user_message_chunk",
        ]) {
          expect(
            router.normalize(
              frame("child", {
                sessionUpdate,
                content: { type: "text", text: "private reasoning" },
              })
            )
          ).toEqual([]);
        }
        const request = {
          jsonrpc: "2.0" as const,
          id: 8,
          method: "session/request_permission",
          params: { sessionId: "child" },
        };
        expect(router.normalize(request)).toEqual([{ ...request, params: { sessionId: "root" } }]);
        const unknown = { ...request, params: { sessionId: "unknown" } };
        expect(router.normalize(unknown)).toEqual([unknown]);
        const ordinary = frame("root", {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Parent reply" },
        });
        expect(router.normalize(ordinary)).toEqual([ordinary]);
      });

      it(`rejects malformed or unrelated lifecycle updates without changing an existing child (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        expect(router.normalize(spawn("root", "root"))).toEqual([]);
        expect(
          router.normalize(
            frame("root", { sessionUpdate: "subagent_spawned", subagentSessionId: "child" })
          )
        ).toEqual([]);
        router.normalize(spawn("root", "child"));
        expect(
          router.normalize(
            frame("other", {
              sessionUpdate: "subagent_state_update",
              subagentSessionId: "child",
              state: "completed",
            })
          )
        ).toEqual([]);
        expect(
          params(
            router.normalize(
              frame("child", {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Still working" },
              })
            )
          ).sessionId
        ).toBe("root");
      });
    });

    describe("clear()", () => {
      it(`rebuilds a reloaded tree without deleting another root's children (${ISSUE})`, () => {
        const router = new AcpSubagentRouter();
        router.normalize(spawn("one", "a"));
        router.normalize(spawn("two", "b"));
        router.clear("one");
        expect(router.normalize(spawn("one", "a"))).toHaveLength(1);
        expect(router.normalize(spawn("two", "b"))).toEqual([]);
        router.clear();
        expect(router.normalize(spawn("two", "b"))).toHaveLength(1);
      });
    });
    describe("wrap()", () => {
      it(`continues reading after dropped child thoughts and usage (${ISSUE})`, async () => {
        const router = new AcpSubagentRouter();
        const incoming = [
          spawn("root", "child"),
          frame("child", {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Hidden" },
          }),
          frame("child", { sessionUpdate: "usage_update" }),
          frame("child", { sessionUpdate: "tool_call", toolCallId: "read", title: "Read note" }),
        ];
        const stream = router.wrap({
          writable: new WritableStream(),
          readable: new ReadableStream({
            start(c) {
              for (const value of incoming) c.enqueue(value);
              c.close();
            },
          }),
        });
        const reader = stream.readable.getReader();
        expect(params([(await reader.read()).value]).update.sessionUpdate).toBe("tool_call");
        expect(params([(await reader.read()).value]).update.toolCallId).toContain("subagent-tool:");
        expect((await reader.read()).done).toBe(true);
      });

      it(`normalizes incoming frames in order and leaves outbound writes unchanged (${ISSUE})`, async () => {
        const writable = new WritableStream();
        const stream = new AcpSubagentRouter().wrap({
          writable,
          readable: new ReadableStream({
            start(c) {
              c.enqueue(spawn("root", "child"));
              c.enqueue({ jsonrpc: "2.0" as const, id: 1, result: {} });
              c.close();
            },
          }),
        });
        expect(stream.writable).toBe(writable);
        const reader = stream.readable.getReader();
        expect(params([(await reader.read()).value]).update.sessionUpdate).toBe("tool_call");
        expect((await reader.read()).value).toMatchObject({ id: 1, result: {} });
        expect((await reader.read()).done).toBe(true);
      });
      it(`cancels the underlying stream when its consumer closes (${ISSUE})`, async () => {
        let cancelled!: (reason: unknown) => void;
        const observed = new Promise((resolve) => {
          cancelled = resolve;
        });
        const stream = new AcpSubagentRouter().wrap({
          writable: new WritableStream(),
          readable: new ReadableStream({ cancel: cancelled }),
        });
        await stream.readable.cancel("closed");
        await expect(observed).resolves.toBe("closed");
      });
    });
  });
});
