import type { AnyMessage, SessionNotification } from "@agentclientprotocol/sdk";
import { deliverSessionUpdatesInWireOrder } from "./sessionUpdateWireOrder";

function sessionUpdate(text: string): AnyMessage {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  };
}

function inboundStream(messages: AnyMessage[]) {
  const writable = new WritableStream<AnyMessage>();
  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      for (const message of messages) controller.enqueue(message);
      controller.close();
    },
  });
  return { readable, writable };
}

describe("sessionUpdateWireOrder", () => {
  describe("deliverSessionUpdatesInWireOrder()", () => {
    it("delivers every session/update before the message that followed it on the wire is readable (https://github.com/Brevilabs/obsidian-copilot-private/issues/602)", async () => {
      const delivered: string[] = [];
      const loadResponse: AnyMessage = { jsonrpc: "2.0", id: 7, result: {} };
      const stream = deliverSessionUpdatesInWireOrder(
        inboundStream([sessionUpdate("first"), sessionUpdate("second"), loadResponse]),
        (n: SessionNotification) => {
          const update = n.update as { content: { text: string } };
          delivered.push(update.content.text);
        }
      );

      const reader = stream.readable.getReader();
      const read = await reader.read();

      expect(read.value).toEqual(loadResponse);
      expect(delivered).toEqual(["first", "second"]);
    });

    it("passes requests, responses, and other notifications through in order without delivering them", async () => {
      const deliver = jest.fn();
      const request: AnyMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {},
      };
      const notification: AnyMessage = {
        jsonrpc: "2.0",
        method: "elicitation/complete",
        params: {},
      };
      const response: AnyMessage = { jsonrpc: "2.0", id: 2, result: null };
      const source = inboundStream([request, notification, response]);
      const stream = deliverSessionUpdatesInWireOrder(source, deliver);

      const passed: AnyMessage[] = [];
      const reader = stream.readable.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) passed.push(r.value);

      expect(passed).toEqual([request, notification, response]);
      expect(deliver).not.toHaveBeenCalled();
      expect(stream.writable).toBe(source.writable);
    });

    it("delivers a session/update unchanged whatever its update kind and fields, leaving their interpretation to the translator", async () => {
      const toolCallUpdate = {
        sessionId: "ses_1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          status: "completed",
          locations: [{ path: "notes/one.md" }],
          content: [
            { type: "content", content: { type: "text", text: "Edit applied successfully." } },
            { type: "diff", path: "notes/one.md", oldText: "six weeks", newText: "nine weeks" },
          ],
        },
      };
      const unknownKind = { sessionId: "ses_1", update: { sessionUpdate: "future_update", x: 1 } };
      const deliver = jest.fn();
      const stream = deliverSessionUpdatesInWireOrder(
        inboundStream([
          { jsonrpc: "2.0", method: "session/update", params: toolCallUpdate },
          { jsonrpc: "2.0", method: "session/update", params: unknownKind },
        ]),
        deliver
      );

      const read = await stream.readable.getReader().read();

      expect(read.done).toBe(true);
      expect(deliver.mock.calls).toEqual([[toolCallUpdate], [unknownKind]]);
    });

    it.each([
      ["no params", undefined],
      ["params that are not an object", "ses_1"],
      ["a non-string session id", { sessionId: 7, update: { sessionUpdate: "plan" } }],
      ["no update", { sessionId: "ses_1" }],
      ["an update without a kind", { sessionId: "ses_1", update: { content: {} } }],
    ])(
      "drops a session/update with %s instead of delivering it or passing it to the SDK (https://github.com/Brevilabs/obsidian-copilot-private/issues/602)",
      async (_label, params) => {
        const deliver = jest.fn();
        const response: AnyMessage = { jsonrpc: "2.0", id: 3, result: {} };
        const stream = deliverSessionUpdatesInWireOrder(
          inboundStream([{ jsonrpc: "2.0", method: "session/update", params }, response]),
          deliver
        );

        const read = await stream.readable.getReader().read();

        expect(read.value).toEqual(response);
        expect(deliver).not.toHaveBeenCalled();
      }
    );
  });
});
