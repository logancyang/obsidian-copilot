import { execFileSync } from "node:child_process";

// Jest maps the ESM-only SDK to a stub. A native Node subprocess exercises the
// installed transport and deprecated connection that the production bundle uses.
describe("sdkCompatibility", () => {
  describe("ClientSideConnection", () => {
    it("reports malformed input and still initializes ACP v1 and delivers the next update https://github.com/Brevilabs/obsidian-copilot-private/issues/550", () => {
      const output = execFileSync(process.execPath, ["--input-type=module"], {
        encoding: "utf8",
        timeout: 10_000,
        input: `
          import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const errors = [];
          let controller;
          let receiveUpdate;
          const updated = new Promise(resolve => { receiveUpdate = resolve; });
          const input = new ReadableStream({ start(value) { controller = value; } });
          const send = value => controller.enqueue(encoder.encode(value + "\\n"));
          const output = new WritableStream({ write(bytes) {
            const message = JSON.parse(decoder.decode(bytes));
            if (message.error) errors.push(message.error.code);
            if (message.method === "initialize") {
              send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } }));
              send(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
                sessionId: "compat-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "still streaming" } }
              } }));
            }
          } });
          const connection = new ClientSideConnection(() => ({
            sessionUpdate: async notification => receiveUpdate(notification),
            requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
          }), ndJsonStream(output, input));
          send("{broken");
          send("false");
          send(JSON.stringify({ jsonrpc: "2.0", method: 42 }));
          const initialized = await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
          const notification = await updated;
          await new Promise(resolve => setTimeout(resolve, 0));
          controller.close();
          await connection.closed;
          process.stdout.write(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, initialized: initialized.protocolVersion, errors, notification }));
        `,
      });
      expect(JSON.parse(output)).toEqual({
        protocolVersion: 1,
        initialized: 1,
        errors: [-32700, -32600, -32600],
        notification: {
          sessionId: "compat-session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "still streaming" },
          },
        },
      });
    });
  });
});
