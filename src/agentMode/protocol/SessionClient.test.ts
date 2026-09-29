import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { SessionClient, type Diagnostic } from "@/agentMode/protocol/SessionClient";
import { INITIAL_SESSION_STATE, type HostState } from "@/agentMode/protocol/state";
import {
  buildHostState,
  buildMessage,
  buildTab,
  FakeTransport,
} from "@/agentMode/protocol/testBuilders";

const HOST_STATE: HostState = buildHostState({ tabs: [buildTab({ id: "s1" })] });

function connect(hostId = "host-1") {
  const transport = new FakeTransport();
  const diagnostics: Diagnostic[] = [];
  const client = new SessionClient(transport, {
    app: "1.0.0",
    onDiagnostic: (d) => diagnostics.push(d),
  });
  transport.setOpen(true);
  transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "host-app", hostId, ok: true });
  return { transport, client, diagnostics };
}

function seedHost(t: FakeTransport, seq = 0) {
  t.deliver({ type: "snapshot", scope: "host", seq, state: HOST_STATE });
}

describe("SessionClient", () => {
  describe("constructor()", () => {
    it("sends hello on open and becomes live after an ok reply, then subscribes to the host scope", () => {
      const { transport, client } = connect();
      expect(transport.sentOfType("hello")).toEqual([
        { type: "hello", v: PROTOCOL_VERSION, app: "1.0.0" },
      ]);
      expect(client.getConnection()).toBe("live");
      expect(transport.sentOfType("subscribe")).toEqual([{ type: "subscribe", scope: "host" }]);
    });

    it("enters version_mismatch and subscribes to nothing when the host rejects the version", () => {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      transport.setOpen(true);
      transport.deliver({ type: "hello", v: 2, app: "9.9.9", hostId: "h", ok: false });
      expect(client.getConnection()).toBe("version_mismatch");
      expect(client.getHostApp()).toBe("9.9.9");
      expect(transport.sentOfType("subscribe")).toEqual([]);
    });

    it("reports reconnecting after a live socket drops and offline when it never connected", () => {
      const live = connect();
      live.transport.setOpen(false);
      expect(live.client.getConnection()).toBe("reconnecting");

      const transport = new FakeTransport();
      const fresh = new SessionClient(transport, { app: "1.0.0" });
      transport.setOpen(false);
      expect(fresh.getConnection()).toBe("offline");
    });

    it("resumes every scope from its cursor on reconnect instead of asking for snapshots", () => {
      const { transport, client } = connect();
      seedHost(transport, 4);
      client.watchSession("s1");
      transport.deliver({
        type: "snapshot",
        scope: "session:s1",
        seq: 9,
        state: INITIAL_SESSION_STATE,
      });
      transport.setOpen(false);
      transport.sent.length = 0;

      transport.setOpen(true);
      transport.deliver({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: "host-app",
        hostId: "host-1",
        ok: true,
      });

      expect(transport.sentOfType("subscribe")).toEqual([
        { type: "subscribe", scope: "host", fromSeq: 4 },
        { type: "subscribe", scope: "session:s1", fromSeq: 9 },
      ]);
    });

    it("discards replicas and cursors when the host id changed across the reconnect", () => {
      const { transport, client } = connect("host-1");
      seedHost(transport, 4);
      transport.setOpen(false);
      transport.setOpen(true);
      transport.deliver({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: "host-app",
        hostId: "host-2",
        ok: true,
      });

      expect(client.getHost()).toBeNull();
      expect(transport.sentOfType("subscribe").at(-1)).toEqual({
        type: "subscribe",
        scope: "host",
      });
    });
  });

  describe("getHost()", () => {
    it("is null until the host snapshot arrives and then holds that state", () => {
      const { transport, client } = connect();
      expect(client.getHost()).toBeNull();
      seedHost(transport);
      expect(client.getHost()).toBe(HOST_STATE);
    });

    it("applies ops in sequence and advances the cursor", () => {
      const { transport, client } = connect();
      seedHost(transport, 0);
      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [
          { t: "tab.patch", id: "s1", patch: { status: "running" } },
          { t: "tab.patch", id: "s1", patch: { label: "Hello" } },
        ],
      });
      expect(client.getHost()?.tabs[0]).toMatchObject({ status: "running", label: "Hello" });
      expect(client.getCursor("host")).toBe(2);
    });

    it("applies only the unseen suffix of an overlapping ops frame", () => {
      const { transport, client } = connect();
      seedHost(transport, 0);
      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
      });
      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [
          { t: "tab.patch", id: "s1", patch: { status: "running" } },
          { t: "tab.patch", id: "s1", patch: { status: "idle" } },
        ],
      });
      expect(client.getHost()?.tabs[0].status).toBe("idle");
      expect(client.getCursor("host")).toBe(2);
    });

    it("drops a frame after a sequence gap, asks for a fresh snapshot, and ignores ops until it arrives", () => {
      const { transport, client, diagnostics } = connect();
      seedHost(transport, 0);
      transport.sent.length = 0;

      transport.deliver({
        type: "ops",
        scope: "host",
        from: 3,
        ops: [{ t: "tab.patch", id: "s1", patch: { status: "error" } }],
      });
      expect(transport.sentOfType("subscribe")).toEqual([{ type: "subscribe", scope: "host" }]);
      expect(diagnostics).toEqual([
        { kind: "gap", scope: "host", detail: "expected 1, received 3" },
      ]);

      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [{ t: "tab.patch", id: "s1", patch: { status: "error" } }],
      });
      expect(client.getHost()?.tabs[0].status).toBe("idle");

      const fresh: HostState = buildHostState({ tabs: [buildTab({ id: "s1", status: "error" })] });
      transport.deliver({ type: "snapshot", scope: "host", seq: 5, state: fresh });
      expect(client.getHost()).toBe(fresh);
      expect(client.getCursor("host")).toBe(5);

      transport.deliver({
        type: "ops",
        scope: "host",
        from: 6,
        ops: [{ t: "tab.patch", id: "s1", patch: { status: "idle" } }],
      });
      expect(client.getHost()?.tabs[0].status).toBe("idle");
    });

    it("reports ops that arrive before any snapshot without applying them", () => {
      const { transport, diagnostics } = connect();
      transport.deliver({ type: "ops", scope: "host", from: 1, ops: [] });
      expect(diagnostics[0]).toMatchObject({ kind: "unexpected_frame", scope: "host" });
    });
  });

  describe("getSession()", () => {
    it("is null until the watched scope delivers a snapshot", () => {
      const { transport, client } = connect();
      client.watchSession("s1");
      expect(client.getSession("s1")).toBeNull();
      transport.deliver({
        type: "snapshot",
        scope: "session:s1",
        seq: 0,
        state: INITIAL_SESSION_STATE,
      });
      expect(client.getSession("s1")).toBe(INITIAL_SESSION_STATE);
    });

    it("folds transcript ops into the session replica", () => {
      const { transport, client } = connect();
      client.watchSession("s1");
      transport.deliver({
        type: "snapshot",
        scope: "session:s1",
        seq: 0,
        state: INITIAL_SESSION_STATE,
      });
      transport.deliver({
        type: "ops",
        scope: "session:s1",
        from: 1,
        ops: [
          { t: "msg.add", message: buildMessage() },
          { t: "msg.appendText", id: "m1", text: "hi", atMs: 1 },
        ],
      });
      expect(client.getSession("s1")?.transcript[0].message).toBe("hi");
    });

    it("becomes null again when the host reports the session gone", () => {
      const { transport, client } = connect();
      client.watchSession("s1");
      transport.deliver({
        type: "snapshot",
        scope: "session:s1",
        seq: 0,
        state: INITIAL_SESSION_STATE,
      });
      transport.deliver({ type: "snapshot", scope: "session:s1", seq: 0, state: null });
      expect(client.getSession("s1")).toBeNull();
    });

    it("ignores frames for a session nobody watches", () => {
      const { transport, client } = connect();
      transport.deliver({
        type: "snapshot",
        scope: "session:s9",
        seq: 0,
        state: INITIAL_SESSION_STATE,
      });
      expect(client.getSession("s9")).toBeNull();
    });
  });

  describe("watchSession()", () => {
    it("subscribes once for several watchers and unsubscribes when the last one leaves", () => {
      const { transport, client } = connect();
      const stopA = client.watchSession("s1");
      const stopB = client.watchSession("s1");
      expect(
        transport.sentOfType("subscribe").filter((f) => f.scope === "session:s1")
      ).toHaveLength(1);

      stopA();
      stopA();
      expect(transport.sentOfType("unsubscribe")).toEqual([]);
      stopB();
      expect(transport.sentOfType("unsubscribe")).toEqual([
        { type: "unsubscribe", scope: "session:s1" },
      ]);
    });

    it("defers the subscription until the connection is live", () => {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      client.watchSession("s1");
      expect(transport.sentOfType("subscribe")).toEqual([]);
      transport.setOpen(true);
      transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
      expect(transport.sentOfType("subscribe").map((f) => f.scope)).toEqual(["host", "session:s1"]);
    });

    it("drops the replica when the last watcher leaves", () => {
      const { transport, client } = connect();
      const stop = client.watchSession("s1");
      transport.deliver({
        type: "snapshot",
        scope: "session:s1",
        seq: 0,
        state: INITIAL_SESSION_STATE,
      });
      stop();
      expect(client.getSession("s1")).toBeNull();
      expect(client.getCursor("session:s1")).toBeNull();
    });
  });

  describe("setFocus()", () => {
    it("sends the focused session once and ignores an unchanged value", () => {
      const { transport, client } = connect();
      client.setFocus("s1");
      client.setFocus("s1");
      client.setFocus(null);
      expect(transport.sentOfType("focus")).toEqual([
        { type: "focus", sessionId: "s1" },
        { type: "focus", sessionId: null },
      ]);
    });

    it("holds the value until the connection is live and sends it after the host accepts hello https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      client.setFocus("s1");
      transport.setOpen(true);
      expect(transport.sentOfType("focus")).toEqual([]);
      transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
      expect(transport.sentOfType("focus")).toEqual([{ type: "focus", sessionId: "s1" }]);
    });

    it("sends the focus again after a reconnect because the host forgets it with the connection", () => {
      const { transport, client } = connect();
      client.setFocus("s1");
      transport.setOpen(false);
      transport.setOpen(true);
      transport.deliver({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: "h",
        hostId: "host-1",
        ok: true,
      });
      expect(transport.sentOfType("focus")).toHaveLength(2);
    });
  });

  describe("command()", () => {
    it("sends the command with a fresh id and resolves with the matching result", async () => {
      const { transport, client } = connect();
      const pending = client.command({ name: "cancel", sessionId: "s1" });
      const [frame] = transport.sentOfType("command");
      expect(frame.command).toEqual({ name: "cancel", sessionId: "s1" });
      transport.deliver({ type: "result", id: frame.id, result: { ok: true, value: undefined } });
      await expect(pending).resolves.toEqual({ ok: true, value: undefined });
    });

    it("resolves overlapping commands by id regardless of reply order", async () => {
      const { transport, client } = connect();
      const first = client.command({ name: "cancel", sessionId: "a" });
      const second = client.command({ name: "cancel", sessionId: "b" });
      const [f1, f2] = transport.sentOfType("command");
      transport.deliver({
        type: "result",
        id: f2.id,
        result: { ok: false, code: "stale", message: "two" },
      });
      transport.deliver({ type: "result", id: f1.id, result: { ok: true, value: undefined } });
      await expect(second).resolves.toMatchObject({ ok: false, code: "stale" });
      await expect(first).resolves.toMatchObject({ ok: true });
    });

    it("fails immediately with disconnected when the connection is not live", async () => {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      await expect(client.command({ name: "cancel", sessionId: "s1" })).resolves.toEqual({
        ok: false,
        code: "failed",
        message: "disconnected",
      });
      expect(transport.sentOfType("command")).toEqual([]);
    });

    it("rejects in-flight commands with disconnected when the socket drops and never re-sends them", async () => {
      const { transport, client } = connect();
      const pending = client.command({ name: "send", sessionId: "s1", text: "hi" });
      transport.setOpen(false);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        code: "failed",
        message: "disconnected",
      });
      transport.setOpen(true);
      transport.deliver({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: "h",
        hostId: "host-1",
        ok: true,
      });
      expect(transport.sentOfType("command")).toHaveLength(1);
    });
  });

  describe("subscribe()", () => {
    it("notifies once per applied frame and not for a frame that changes nothing", () => {
      const { transport, client } = connect();
      const listener = jest.fn();
      client.subscribe(listener);
      seedHost(transport, 0);
      expect(listener).toHaveBeenCalledTimes(1);
      transport.deliver({ type: "ops", scope: "host", from: 1, ops: [] });
      expect(listener).toHaveBeenCalledTimes(1);
      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [
          { t: "tab.patch", id: "s1", patch: { status: "running" } },
          { t: "tab.patch", id: "s1", patch: { status: "idle" } },
        ],
      });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("stops notifying after the returned unsubscribe runs", () => {
      const { transport, client } = connect();
      const listener = jest.fn();
      client.subscribe(listener)();
      seedHost(transport);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("closes the transport, detaches from its frames and fails pending commands", async () => {
      const { transport, client } = connect();
      const pending = client.command({ name: "cancel", sessionId: "s1" });
      client.dispose();
      expect(transport.closed).toBe(true);
      await expect(pending).resolves.toMatchObject({ ok: false, message: "disconnected" });
      seedHost(transport);
      expect(client.getHost()).toBeNull();
    });

    it("reports offline and fails later commands with disconnected once disposed", async () => {
      const { transport, client } = connect();
      client.dispose();
      expect(client.getConnection()).toBe("offline");
      await expect(client.command({ name: "cancel", sessionId: "s1" })).resolves.toMatchObject({
        ok: false,
        message: "disconnected",
      });
      expect(transport.sentOfType("command")).toEqual([]);
    });
  });
});
