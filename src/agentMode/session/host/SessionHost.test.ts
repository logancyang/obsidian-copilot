import { PROTOCOL_VERSION, type ServerFrame } from "@/agentMode/protocol/frames";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import {
  buildHost,
  FakeManager,
  fakeNote,
  makeTestSession,
  settle,
  type TestSession,
} from "@/agentMode/session/host/hostTestHarness";
import type { InProcessTransport } from "@/agentMode/session/host/inProcessTransport";
import type { SessionHost } from "@/agentMode/session/host/SessionHost";
import type { SessionEvent } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const text = (sessionId: string, chunk: string): SessionEvent => ({
  sessionId,
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
});

interface Rig {
  manager: FakeManager;
  host: SessionHost;
  one: TestSession;
  client: SessionClient;
  transport: InProcessTransport;
  frames: ServerFrame[];
}

async function rig(options: Parameters<typeof buildHost>[1] = {}): Promise<Rig> {
  const manager = new FakeManager();
  const one = makeTestSession("s1");
  manager.add(one.session);
  const host = buildHost(manager, options);
  const { client, transport } = host.createClient({ serialize: true });
  const frames: ServerFrame[] = [];
  transport.onFrame((frame) => frames.push(frame));
  client.watchSession("s1");
  await settle();
  return { manager, host, one, client, transport, frames };
}

type OpsFrame = Extract<ServerFrame, { type: "ops" }>;

function opsFrames(frames: ServerFrame[], scope: string): OpsFrame[] {
  return frames.filter((f): f is OpsFrame => f.type === "ops" && f.scope === scope);
}

function expectReplicaEqualsHost(r: Rig, id = "s1"): void {
  expect(r.client.getSession(id)).toEqual(r.host.getSessionState(id));
  expect(r.client.getHost()).toEqual(r.host.getHostState());
}

describe("SessionHost", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("connect()", () => {
    it("answers hello with its host id and ok when the protocol versions match", async () => {
      const r = await rig();
      expect(r.frames[0]).toEqual({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: "test-1.0.0",
        hostId: "host-under-test",
        ok: true,
      });
      expect(r.client.getConnection()).toBe("live");
    });

    it("answers hello with ok false on a version mismatch and ignores later frames", () => {
      const manager = new FakeManager();
      const host = buildHost(manager);
      const sent: ServerFrame[] = [];
      const connection = host.connect((frame) => sent.push(frame));
      connection.receive({ type: "hello", v: PROTOCOL_VERSION + 1, app: "future" });
      connection.receive({ type: "subscribe", scope: "host" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "hello", ok: false });
    });

    it("ignores frames that arrive before hello", () => {
      const host = buildHost(new FakeManager());
      const sent: ServerFrame[] = [];
      host.connect((frame) => sent.push(frame)).receive({ type: "subscribe", scope: "host" });
      expect(sent).toEqual([]);
    });

    it("sends a snapshot of the tab set and of the session scope on first subscribe", async () => {
      const r = await rig();
      expect(r.client.getHost()?.tabs.map((tab) => tab.id)).toEqual(["s1"]);
      expect(r.client.getSession("s1")).not.toBeNull();
      expect(
        r.frames.filter((f) => f.type === "snapshot").map((f) => (f as { scope: string }).scope)
      ).toEqual(["host", "session:s1"]);
    });

    it("keeps the replica equal to the host while a turn streams text, thoughts and tool calls", async () => {
      const r = await rig();
      const release = r.one.backend.holdPrompt();
      const { turn } = r.one.session.sendPrompt("hello there");
      r.one.backend.emit({
        sessionId: "acp-s1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        },
      });
      r.one.backend.emit(text("acp-s1", "Hel"));
      r.one.backend.emit(text("acp-s1", "lo"));
      r.one.backend.emit({
        sessionId: "acp-s1",
        update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "pending" },
      });
      jest.advanceTimersByTime(20);
      await settle();
      expectReplicaEqualsHost(r);
      expect(r.client.getSession("s1")?.transcript[1].message).toBe("Hello");
      release();
      await turn;
      await settle();
      expectReplicaEqualsHost(r);
      expect(r.client.getHost()?.tabs[0].status).toBe("idle");
      expect(r.client.getSession("s1")?.transcript[1].turnStopReason).toBe("end_turn");
    });

    it("sends streamed ops in one frame after 16 ms and carries them ahead of a later non-streaming op", async () => {
      const r = await rig();
      r.one.backend.holdPrompt();
      r.one.session.sendPrompt("hi");
      await settle();
      r.frames.length = 0;

      r.one.backend.emit(text("acp-s1", "a"));
      r.one.backend.emit(text("acp-s1", "b"));
      await settle();
      expect(r.frames).toEqual([]);

      jest.advanceTimersByTime(16);
      await settle();
      const streamed = opsFrames(r.frames, "session:s1");
      expect(streamed).toHaveLength(1);
      expect(streamed[0].ops).toHaveLength(2);

      r.frames.length = 0;
      r.one.backend.emit(text("acp-s1", "c"));
      void r.one.session.handleToolPermission({
        sessionId: "acp-s1",
        toolCall: { toolCallId: "tc1", title: "Write", kind: "edit", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
      });
      await settle();
      const carried = opsFrames(r.frames, "session:s1");
      expect(carried).toHaveLength(1);
      expect(carried[0].ops.map((op) => op.t)).toEqual(["msg.appendText", "slice"]);
    });

    it("projects pending permissions, questions and plan changes as slice ops", async () => {
      const r = await rig();
      r.one.session.sendPrompt("edit");
      const decision = r.one.session.handleToolPermission({
        sessionId: "acp-s1",
        toolCall: { toolCallId: "tc1", title: "Write", kind: "edit", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
      });
      const answers = r.one.session.handleAskUserQuestion({
        sessionId: "acp-s1",
        requestId: "q1",
        questions: [{ question: "Which?", options: [{ label: "A" }] }],
        signal: new AbortController().signal,
      });
      await settle();
      const pending = r.client.getSession("s1")!.pending;
      expect(pending.permissions.map((p) => p.toolCall.toolCallId)).toEqual(["tc1"]);
      expect(pending.questions).toEqual([
        {
          sessionId: "acp-s1",
          requestId: "q1",
          questions: [{ question: "Which?", options: [{ label: "A" }] }],
        },
      ]);
      expect(r.client.getHost()?.tabs[0].status).toBe("awaiting_permission");

      r.one.session.resolveToolPermission("tc1", "allow_once");
      r.one.session.resolveAskUserQuestion("q1", {});
      await Promise.all([decision, answers]);
      await settle();
      expect(r.client.getSession("s1")!.pending.permissions).toEqual([]);
      expectReplicaEqualsHost(r);
    });

    it("resumes from the client's cursor with one ops frame and no snapshot after a reconnect", async () => {
      const r = await rig();
      r.one.backend.holdPrompt();
      r.one.session.sendPrompt("hi");
      await settle();
      r.transport.disconnect();
      r.one.backend.emit(text("acp-s1", "while offline"));
      r.one.session.markNeedsAttention();
      jest.advanceTimersByTime(20);
      r.frames.length = 0;

      r.transport.reconnect();
      await settle();

      expect(r.frames.filter((f) => f.type === "snapshot")).toEqual([]);
      expect(opsFrames(r.frames, "session:s1")).toHaveLength(1);
      expectReplicaEqualsHost(r);
    });

    it("answers a resume with an empty ops frame when the client is already current", async () => {
      const r = await rig();
      r.transport.disconnect();
      r.frames.length = 0;
      r.transport.reconnect();
      await settle();
      const resumed = r.frames.filter((f): f is OpsFrame => f.type === "ops");
      expect(resumed).toHaveLength(2);
      expect(resumed.every((f) => f.ops.length === 0)).toBe(true);
    });

    it("falls back to a snapshot when the client's cursor was evicted from the log", async () => {
      const r = await rig({ opLogLimits: { maxOps: 3, maxBytes: 1_000_000 } });
      r.one.backend.holdPrompt();
      r.one.session.sendPrompt("hi");
      await settle();
      r.transport.disconnect();
      for (let i = 0; i < 10; i++) r.one.backend.emit(text("acp-s1", `chunk${i}`));
      jest.advanceTimersByTime(20);
      r.frames.length = 0;

      r.transport.reconnect();
      await settle();

      expect(r.frames.some((f) => f.type === "snapshot" && f.scope === "session:s1")).toBe(true);
      expectReplicaEqualsHost(r);
    });

    it("recovers from a dropped frame with a fresh snapshot instead of diverging", async () => {
      const r = await rig();
      r.one.backend.holdPrompt();
      r.one.session.sendPrompt("hi");
      await settle();
      r.transport.dropNextFrame();
      r.one.backend.emit(text("acp-s1", "lost"));
      jest.advanceTimersByTime(20);
      await settle();
      r.one.backend.emit(text("acp-s1", " kept"));
      jest.advanceTimersByTime(20);
      await settle();
      expectReplicaEqualsHost(r);
      expect(r.client.getSession("s1")?.transcript[1].message).toBe("lost kept");
    });

    it("sends notes as vault path references and keeps the message reducible from ops", async () => {
      const r = await rig();
      r.one.session.sendPrompt("look", { notes: [fakeNote("Projects/plan.md")], urls: [] });
      await settle();
      expect(r.client.getSession("s1")?.transcript[0].context?.notes).toEqual([
        { path: "Projects/plan.md", basename: "plan" },
      ]);
      expectReplicaEqualsHost(r);
    });

    it("stops delivering frames for a scope after unsubscribe", async () => {
      const r = await rig();
      const stop = r.client.watchSession("s1");
      stop();
      r.client.watchSession("s1")();
      await settle();
      r.frames.length = 0;
      r.one.session.markNeedsAttention();
      await settle();
      expect(opsFrames(r.frames, "session:s1")).toEqual([]);
    });
  });

  describe("session and tab lifecycle", () => {
    it("adds a tab and binds a session scope when the manager gains a session", async () => {
      const r = await rig();
      const two = makeTestSession("s2", "codex");
      const stop = r.client.watchSession("s2");
      await settle();
      expect(r.client.getSession("s2")).toBeNull();

      r.manager.add(two.session);
      await settle();

      expect(r.client.getHost()?.tabs.map((t) => t.id)).toEqual(["s1", "s2"]);
      expect(r.client.getSession("s2")).not.toBeNull();
      stop();
    });

    it("removes the tab and answers a null snapshot when the manager drops a session", async () => {
      const r = await rig();
      r.manager.remove("s1");
      await settle();
      expect(r.client.getHost()?.tabs).toEqual([]);
      expect(r.client.getSession("s1")).toBeNull();
    });

    it("keeps a detached session's scope available while removing its tab", async () => {
      const r = await rig();
      r.manager.detach("s1");
      await settle();
      expect(r.client.getHost()?.tabs).toEqual([]);
      expect(r.client.getSession("s1")).not.toBeNull();
    });

    it("re-adds a re-attached tab at its position and follows a reorder", async () => {
      const r = await rig();
      r.manager.add(makeTestSession("s2").session);
      r.manager.add(makeTestSession("s3").session);
      r.manager.reorder(["s3", "s1", "s2"]);
      await settle();
      expect(r.client.getHost()?.tabs.map((t) => t.id)).toEqual(["s3", "s1", "s2"]);
      expectReplicaEqualsHost(r);
    });

    it("patches label and attention changes onto the tab", async () => {
      const r = await rig();
      r.one.session.setLabel("Research");
      r.one.session.markNeedsAttention();
      await settle();
      expect(r.client.getHost()?.tabs[0]).toMatchObject({
        label: "Research",
        labelSource: "user",
        needsAttention: true,
      });
    });

    it("rebinds with a fresh snapshot when the manager swaps the session behind an id", async () => {
      const r = await rig();
      r.one.session.sendPrompt("old");
      await settle();
      const replacement = makeTestSession("s1");
      r.manager.remove("s1");
      r.manager.add(replacement.session);
      await settle();
      expect(r.client.getSession("s1")?.transcript).toEqual([]);
      expectReplicaEqualsHost(r);
    });
  });

  describe("getHostState()", () => {
    it("reflects the tab projection the log describes", async () => {
      const r = await rig();
      expect(r.host.getHostState().tabs.map((t) => t.id)).toEqual(["s1"]);
    });
  });

  describe("getSessionState()", () => {
    it("returns null for an id the host has not bound", async () => {
      const r = await rig();
      expect(r.host.getSessionState("nope")).toBeNull();
    });
  });

  describe("getHostId()", () => {
    it("returns the id announced in hello", async () => {
      const r = await rig();
      expect(r.host.getHostId()).toBe("host-under-test");
    });
  });

  describe("createClient()", () => {
    it("serializes frames by default outside production builds", async () => {
      const r = await rig();
      const other = r.host.createClient();
      await settle();
      expect(other.client.getConnection()).toBe("live");
      expect(other.client.getHost()).not.toBe(r.host.getHostState());
      expect(other.client.getHost()).toEqual(r.host.getHostState());
    });

    it("passes state by reference when serialization is off", async () => {
      const r = await rig();
      const other = r.host.createClient({ serialize: false });
      await settle();
      expect(other.client.getHost()).toBe(r.host.getHostState());
    });
  });

  describe("dispose()", () => {
    it("detaches from the manager and sessions so later changes produce no frames", async () => {
      const r = await rig();
      r.host.dispose();
      r.frames.length = 0;
      r.manager.add(makeTestSession("s2").session);
      r.one.session.markNeedsAttention();
      jest.advanceTimersByTime(50);
      await settle();
      expect(r.frames).toEqual([]);
    });
  });
});
