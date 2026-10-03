const { createInterface } = require("node:readline");
const { randomUUID } = require("node:crypto");
const kind = process.env.FAKE_COMPANION;
const args = process.argv.slice(2);
if (kind === "antigravity" && process.env.FAKE_AGY_TRACE)
  require("node:fs").appendFileSync(process.env.FAKE_AGY_TRACE, JSON.stringify(args) + "\n");
const write = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
if (args.includes("--version")) {
  process.stdout.write("1.3.0\n");
  process.exit(0);
}
if (args.includes("--help")) {
  process.stdout.write("--input-format stream-json\n");
  process.exit(0);
}
if (args.includes("models")) {
  process.stdout.write(
    process.env.FAKE_AGY_MODELS ??
      "fixture-medium\tFixture Medium\nfixture-high\tFixture High\nplain\tPlain\n"
  );
  process.exit(0);
}
let counter = 0;
const models = {
  currentModelId: "fixture",
  availableModels: [
    {
      modelId: "fixture",
      name: "Fixture",
      _meta: { reasoningEfforts: [{ value: "low" }, { value: "high" }] },
    },
    { modelId: "plain", name: "Plain" },
    { modelId: "reject", name: "Rejected selection" },
  ],
};
const rpc = (id, result) => write({ jsonrpc: "2.0", id, result });
const update = (sessionId, update) =>
  write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });
let sessionId;
let workspaceRoot;
let promptId;
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  const p = frame.params ?? {};
  if (kind === "antigravity") {
    write({
      event: "init",
      conversation_id: args[args.indexOf("--conversation") + 1] || randomUUID(),
    });
    write({
      event: "step_update",
      step_update: { step_type: "agent_response", text_delta: "AGY fixture response" },
    });
    write({
      event: "result",
      result: { status: "SUCCESS", usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } },
    });
    return;
  }
  if (kind === "muse") {
    if (frame.method === "initialize")
      return rpc(frame.id, {
        serverInfo: { name: "fake-muse", version: "1.3.0" },
        schema: { fingerprint: "fixture" },
      });
    if (frame.method === "model/list")
      return rpc(frame.id, {
        models: [{ modelId: "fixture", displayLabel: "Fixture", isDefault: true }],
      });
    if (frame.method === "session/start") {
      sessionId = randomUUID();
      workspaceRoot = p.workspaceRoot;
      return rpc(frame.id, {
        status: "accepted",
        session: {
          sessionId,
          workspaceRoot,
          modelId: "fixture",
          approvalMode: { mode: p.approvalMode },
        },
      });
    }
    if (frame.method === "session/resume") {
      sessionId = p.sessionId;
      workspaceRoot = process.cwd();
      return rpc(frame.id, {
        status: "accepted",
        session: {
          sessionId,
          workspaceRoot,
          modelId: "fixture",
          approvalMode: { mode: "promptUnmatched" },
        },
        history: { mode: "inline", items: [] },
      });
    }
    if (frame.method === "session/list") return rpc(frame.id, { sessions: [], nextCursor: null });
    if (frame.method === "turn/start") {
      const turnId = randomUUID();
      rpc(frame.id, { status: "accepted", disposition: "started", turnId });
      notify("item/completed", {
        sessionId,
        item: {
          itemId: "message",
          revision: 1,
          kind: "agentMessage",
          text: "Muse fixture response",
        },
      });
      setTimeout(() => notify("turn/completed", { sessionId, turnId, terminal: "completed" }), 10);
      return;
    }
    if (frame.method === "usage/read") return rpc(frame.id, { usage: null });
    if (frame.id !== undefined) return rpc(frame.id, { status: "accepted" });
    return;
  }
  if (frame.method === "initialize")
    return rpc(frame.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
    });
  if (frame.method === "session/new") {
    sessionId = `fake-${++counter}`;
    return rpc(frame.id, {
      sessionId,
      models,
    });
  }
  if (frame.method === "session/load") return rpc(frame.id, { sessionId: p.sessionId, models });
  if (frame.method === "session/set_model")
    return rpc(frame.id, {
      _meta: { model: p.modelId === "reject" ? { Err: "Model unavailable" } : { Ok: p.modelId } },
    });
  if (frame.method === "session/set_mode") {
    if (!["default", "plan"].includes(p.modeId))
      return write({
        jsonrpc: "2.0",
        id: frame.id,
        error: { code: -32602, message: "Unknown native mode" },
      });
    update(p.sessionId, { sessionUpdate: "current_mode_update", currentModeId: p.modeId });
    return rpc(frame.id, {});
  }
  if (frame.method === "session/list") return rpc(frame.id, { sessions: [] });
  if (frame.method === "session/prompt") {
    if (process.env.FAKE_INVALID_USAGE === "1")
      update(p.sessionId, { sessionUpdate: "usage_update", used: 7 });

    promptId = frame.id;
    const text = p.prompt.map((item) => item.text ?? "").join("");
    if (text === "wait") return;
    if (text === "tool") {
      write({
        jsonrpc: "2.0",
        id: "tool-review",
        method: "session/request_permission",
        params: {
          sessionId: p.sessionId,
          toolCall: { toolCallId: "tool", title: "Edit note", kind: "edit", status: "pending" },
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow" },
            { optionId: "deny", kind: "reject_once", name: "Deny" },
          ],
        },
      });
      return;
    }
    if (text === "plan") {
      write({
        jsonrpc: "2.0",
        id: "review",
        method: "x.ai/exit_plan_mode",
        params: { sessionId: p.sessionId, planContent: "# Fixture plan" },
      });
      return;
    }
    update(p.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Grok fixture response" },
    });
    return rpc(frame.id, { stopReason: "end_turn" });
  }
  if (frame.method === "session/cancel") return rpc(promptId, { stopReason: "cancelled" });
  if (!frame.method && frame.id === "review")
    return rpc(promptId, {
      stopReason: frame.result?.outcome === "approved" ? "end_turn" : "cancelled",
    });
  if (!frame.method && frame.id === "tool-review")
    return rpc(promptId, {
      stopReason: frame.result?.outcome?.optionId === "allow" ? "end_turn" : "cancelled",
    });
});
