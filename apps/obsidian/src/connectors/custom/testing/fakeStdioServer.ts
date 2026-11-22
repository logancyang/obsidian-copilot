import type { StdioServerOptions } from "@/connectors/custom/stdioServer";
import { requireNodeModule } from "@/utils/desktopRuntime";

const SOURCE = String.raw`
const { spawn } = require("child_process");
const readline = require("readline");
if (!process.env.FAKE_KEY) {
  process.stderr.write("starting up\nFAKE_KEY is not set\n");
  process.exit(1);
}
if (process.env.FAKE_GRANDCHILD) {
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: ["ignore", "inherit", "inherit"] });
}
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
process.stdout.write("a log line that isn't JSON\n");
let waitingForPing;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === "server-ping" && message.result) {
    return send({ id: waitingForPing, result: { content: [{ type: "text", text: "pinged" }] } });
  }
  if (message.id === undefined) return;
  if (message.method === "initialize" && process.env.FAKE_SLOW_START_MARKER) {
    return require("fs").writeFileSync(process.env.FAKE_SLOW_START_MARKER, "");
  }
  if (message.method === "initialize") {
    return send({ id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  }
  if (message.method === "tools/list") {
    return send({ id: message.id, result: { tools: [
      { name: "echo", description: "Echo text back.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "crash", inputSchema: { type: "object" } },
    ] } });
  }
  if (message.method === "tools/call" && message.params.name === "crash") {
    process.stderr.write("crashing on request\n");
    process.exit(3);
  }
  if (message.method === "tools/call" && message.params.name === "ping") {
    waitingForPing = message.id;
    return send({ id: "server-ping", method: "ping" });
  }
  if (message.method === "tools/call" && message.params.name === "args") {
    return send({ id: message.id, result: { content: [{ type: "text", text: JSON.stringify(process.argv.slice(2)) }] } });
  }
  if (message.method === "tools/call") {
    return send({ id: message.id, result: { content: [{ type: "text", text: "echo: " + message.params.arguments.text }] } });
  }
  send({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
});
`;

export function fakeStdioServer(
  env: Record<string, string> = { FAKE_KEY: "k" }
): StdioServerOptions {
  return { command: process.execPath, args: ["-e", SOURCE], env: { ...process.env, ...env } };
}

export function fakeStdioServerBehindLauncher(dir: string, args: string[]): StdioServerOptions {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const script = path.join(dir, "server.js");
  fs.writeFileSync(script, SOURCE);
  const launcher = path.join(
    dir,
    process.platform === "win32" ? "launch server.cmd" : "launch server"
  );
  fs.writeFileSync(
    launcher,
    process.platform === "win32"
      ? `@"${process.execPath}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
    { mode: 0o755 }
  );
  return { command: launcher, args: [script, ...args], env: { ...process.env, FAKE_KEY: "k" } };
}
