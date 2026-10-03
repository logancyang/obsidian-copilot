import type { CompanionWireFrame } from "./wire";
import { nativePlanResult, planPermission } from "./plan";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { AgyAcpAdapterServer } from "./antigravity";

const sessions = new Map<string, AgyAcpAdapterServer>();
const permissions = new Map<
  string,
  { server: AgyAcpAdapterServer; id: string | number; plan: boolean }
>();
let nextPermission = 0;
const send = (frame: unknown) => process.stdout.write(JSON.stringify(frame) + "\n");
function makeServer(): AgyAcpAdapterServer {
  let buffer = "";
  const output = new Writable({
    write(chunk, _encoding, done) {
      buffer += String(chunk);
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const frame = JSON.parse(line) as CompanionWireFrame;
          if (frame.method && frame.id !== undefined) {
            const id = `agy-permission:${++nextPermission}`;
            const plan = frame.method === "x.ai/exit_plan_mode";
            permissions.set(id, { server, id: frame.id, plan });
            frame.id = id;
            if (plan) {
              frame.method = "session/request_permission";
              frame.params = planPermission(frame.params!, id);
            }
          }
          if (frame.result?.sessionId) sessions.set(frame.result.sessionId, server);
          if (frame.result?.agentCapabilities)
            frame.result.agentCapabilities.sessionCapabilities = { list: {}, close: {} };
          if (frame.result?.configOptions) {
            frame.result.modes = {
              currentModeId: server.currentModeId,
              availableModes: [
                { id: "agent", name: "Automatic tools" },
                { id: "plan", name: "Plan" },
              ],
            };
          }
          if (frame.params?.update?.sessionUpdate === "plan") continue;
          send(frame);
        } catch (error) {
          process.stderr.write(String(error) + "\n");
        }
      }
      done();
    },
  });
  const server = new AgyAcpAdapterServer({ outputStream: output });
  return server;
}
const root = makeServer();
root.sweepStagedImages();
const stop = () => {
  for (const server of new Set([root, ...sessions.values()])) server.dispose();
  process.stdin.destroy();
};
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  void (async () => {
    let frame: CompanionWireFrame | undefined;
    try {
      frame = JSON.parse(line) as CompanionWireFrame;
      if (!frame.method) {
        const pending = frame.id === undefined ? undefined : permissions.get(String(frame.id));
        if (pending) {
          permissions.delete(String(frame.id));
          frame.id = pending.id;
          if (pending.plan)
            frame.result = nativePlanResult(frame.result as Parameters<typeof nativePlanResult>[0]);
          await pending.server.handleClientLine(JSON.stringify(frame));
        }
        return;
      }
      if (frame.method === "session/new" || frame.method === "session/load") {
        const prior = frame.params?.sessionId && sessions.get(frame.params.sessionId);
        if (prior) {
          prior.dispose();
          sessions.delete(frame.params!.sessionId);
        }
        const server = makeServer();
        await server.handleClientLine(line);
        if (!server.sessionId) server.dispose();
        return;
      }
      const server = frame.params?.sessionId ? sessions.get(frame.params.sessionId) : root;
      if (!server) throw new Error("Unknown Antigravity session");
      if (frame.method === "session/close") {
        server.dispose();
        sessions.delete(frame.params!.sessionId);
        send({ jsonrpc: "2.0", id: frame.id, result: {} });
        return;
      }
      if (frame.method === "session/set_config_option") {
        const p = frame.params;
        const option = server.getConfigOptions().find((option) => option.id === p?.configId);
        if (!option || !option.options.some((value) => value.value === p?.value))
          throw new Error("Unsupported Antigravity configuration");
      }
      if (
        frame.method === "session/set_mode" &&
        !["agent", "plan"].includes(frame.params?.modeId ?? "")
      )
        throw new Error("Unsupported Antigravity mode");
      await server.handleClientLine(line);
      if (frame.method === "session/set_config_option") {
        const configOptions = server.getConfigOptions();
        send({
          method: "session/update",
          params: {
            sessionId: frame.params!.sessionId,
            update: { sessionUpdate: "config_option_update", configOptions },
          },
        });
      }
    } catch (error) {
      if (frame?.id !== undefined)
        send({ jsonrpc: "2.0", id: frame.id, error: { code: -32603, message: String(error) } });
    }
  })();
});
input.on("close", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdout.on("error", stop);
