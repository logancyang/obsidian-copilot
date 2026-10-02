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
  });
});
