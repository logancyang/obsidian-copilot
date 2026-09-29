import type { Command } from "@/agentMode/protocol/commands";
import type { ServerFrame } from "@/agentMode/protocol/frames";
import { MAX_IMAGE_BYTES } from "@/agentMode/protocol/limits";
import { runCommand } from "@/agentMode/session/host/commandHandlers";
import {
  buildHost,
  FakeManager,
  makeTestSession,
  settle,
} from "@/agentMode/session/host/hostTestHarness";
import type { PermissionPrompt } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const PERMISSION: PermissionPrompt = {
  sessionId: "acp-s1",
  toolCall: { toolCallId: "tc1", title: "Write", kind: "edit", status: "pending" },
  options: [
    { optionId: "allow_once", name: "Allow", kind: "allow_once" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ],
};

const PLAN_REQUEST: PermissionPrompt = {
  sessionId: "acp-s1",
  toolCall: {
    toolCallId: "tc-plan",
    kind: "switch_mode",
    status: "pending",
    title: "ExitPlanMode",
    rawInput: { plan: "# plan", planFilePath: "/vault/plan.md" },
    vendorToolName: "ExitPlanMode",
    isPlanProposal: true,
  },
  options: [
    { optionId: "allow_once", name: "Allow", kind: "allow_once" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ],
};

function setup() {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  const manager = new FakeManager();
  const one = makeTestSession("s1");
  manager.add(one.session);
  const host = buildHost(manager);
  const { client, transport } = host.createClient({ serialize: true });
  const frames: ServerFrame[] = [];
  transport.onFrame((frame) => frames.push(frame));
  client.watchSession("s1");
  const run = async (command: Command) => {
    await settle();
    frames.length = 0;
    const result = await client.command(command);
    await settle();
    const ops = frames.flatMap((f) =>
      f.type === "ops" && f.scope === "session:s1" ? f.ops.map((op) => op.t) : []
    );
    const order = frames.map((f) => f.type);
    return { result, ops, order, frames };
  };
  return { manager, one, host, client, run };
}

describe("commandHandlers", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("runCommand()", () => {
    it("send starts a turn and returns the user message id, emitting both messages before the result", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      const { result, ops, order } = await t.run({ name: "send", sessionId: "s1", text: "hello" });
      expect(result).toMatchObject({ ok: true, value: { droppedNotePaths: [] } });
      expect(ops.slice(0, 2)).toEqual(["msg.add", "msg.add"]);
      expect(order.at(-1)).toBe("result");
      const transcript = t.client.getSession("s1")!.transcript;
      expect(transcript[0]).toMatchObject({
        message: "hello",
        id: (result as { value: { userMessageId: string } }).value.userMessageId,
      });
      expect(t.client.getHost()?.tabs[0].status).toBe("running");
    });

    it("send resolves note paths, reports the ones it dropped, and forwards images and mentioned agents", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      const { result } = await t.run({
        name: "send",
        sessionId: "s1",
        text: "see",
        context: { notePaths: ["a/b.md", "missing/c.md"], urls: [] },
        images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
      });
      expect(result).toMatchObject({ ok: true, value: { droppedNotePaths: ["missing/c.md"] } });
      const user = t.client.getSession("s1")!.transcript[0];
      expect(user.context?.notes).toEqual([{ path: "a/b.md", basename: "b" }]);
      expect(JSON.stringify(user.content)).toContain("data:image/png;base64,aGVsbG8=");
    });

    it.each([
      ["unknown_session", { name: "send", sessionId: "nope", text: "x" }],
      ["invalid", { name: "send", sessionId: "s1", text: "   " }],
      ["invalid", { name: "send", sessionId: "s1", text: "x", mentionedAgents: ["mystery"] }],
      [
        "invalid",
        {
          name: "send",
          sessionId: "s1",
          text: "x",
          images: [{ mimeType: "image/bmp", data: "QQ==" }],
        },
      ],
      [
        "too_large",
        {
          name: "send",
          sessionId: "s1",
          text: "x",
          images: [
            { mimeType: "image/png", data: "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 1) * 4) / 3)) },
          ],
        },
      ],
      [
        "too_large",
        {
          name: "send",
          sessionId: "s1",
          text: "x",
          images: Array.from({ length: 5 }, () => ({ mimeType: "image/png", data: "QQ==" })),
        },
      ],
    ] as [string, Command][])(
      "send answers %s without emitting ops (%#)",
      async (code, command) => {
        const t = setup();
        const { result, ops } = await t.run(command);
        expect(result).toMatchObject({ ok: false, code });
        expect(ops).toEqual([]);
      }
    );

    it("send answers session_busy while a turn runs and session_closed after dispose", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "first" });
      const busy = await t.run({ name: "send", sessionId: "s1", text: "second" });
      expect(busy.result).toMatchObject({ ok: false, code: "session_busy" });

      const other = makeTestSession("s2");
      t.manager.add(other.session);
      await other.session.dispose();
      const closed = await t.run({ name: "send", sessionId: "s2", text: "x" });
      expect(closed.result).toMatchObject({ ok: false, code: "session_closed" });
    });

    it("cancel ends a running turn as cancelled and is idempotent when nothing runs", async () => {
      const t = setup();
      const release = t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "go" });
      const cancelled = await t.run({ name: "cancel", sessionId: "s1" });
      expect(cancelled.result).toEqual({ ok: true, value: undefined });
      expect(cancelled.ops).toContain("msg.turnComplete");
      expect(t.client.getSession("s1")!.transcript[1].turnStopReason).toBe("cancelled");
      release("cancelled");

      const again = await t.run({ name: "cancel", sessionId: "s1" });
      expect(again.result).toEqual({ ok: true, value: undefined });
      expect((await t.run({ name: "cancel", sessionId: "nope" })).result).toMatchObject({
        code: "unknown_session",
      });
    });

    it("resolvePermission answers the pending prompt, clears it, and resumes status", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "edit" });
      const decision = t.one.session.handleToolPermission(PERMISSION);
      await settle();
      expect(t.client.getSession("s1")!.pending.permissions).toHaveLength(1);

      const { result, ops } = await t.run({
        name: "resolvePermission",
        sessionId: "s1",
        toolCallId: "tc1",
        optionId: "allow_once",
      });
      expect(result).toEqual({ ok: true, value: undefined });
      await expect(decision).resolves.toEqual({
        outcome: { outcome: "selected", optionId: "allow_once" },
      });
      expect(ops).toContain("slice");
      expect(t.client.getSession("s1")!.pending.permissions).toEqual([]);
      expect(t.client.getHost()?.tabs[0].status).toBe("running");
    });

    it("resolvePermission answers stale for an unknown request and invalid for an unknown option", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "edit" });
      void t.one.session.handleToolPermission(PERMISSION);
      const stale = await t.run({
        name: "resolvePermission",
        sessionId: "s1",
        toolCallId: "other",
        optionId: "allow_once",
      });
      expect(stale.result).toMatchObject({ ok: false, code: "stale" });
      const invalid = await t.run({
        name: "resolvePermission",
        sessionId: "s1",
        toolCallId: "tc1",
        optionId: "bogus",
      });
      expect(invalid.result).toMatchObject({ ok: false, code: "invalid" });
      expect(t.client.getSession("s1")!.pending.permissions).toHaveLength(1);
    });

    it("two devices answering the same permission produce one ok and one stale", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "edit" });
      void t.one.session.handleToolPermission(PERMISSION);
      await settle();
      const phone = t.host.createClient({ serialize: true }).client;
      await settle();
      const command = {
        name: "resolvePermission",
        sessionId: "s1",
        toolCallId: "tc1",
        optionId: "allow_once",
      } as const;
      const results = await Promise.all([t.client.command(command), phone.command(command)]);
      expect(results.map((r) => (r.ok ? "ok" : r.code)).sort()).toEqual(["ok", "stale"]);
    });

    it("answerQuestion records the answers as a tool part and clears the question", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "ask" });
      const answers = t.one.session.handleAskUserQuestion({
        sessionId: "acp-s1",
        requestId: "q1",
        questions: [{ question: "Which?", options: [{ label: "A" }] }],
      });
      await settle();
      const { result, ops } = await t.run({
        name: "answerQuestion",
        sessionId: "s1",
        requestId: "q1",
        answers: { "Which?": "A" },
      });
      expect(result).toEqual({ ok: true, value: undefined });
      await expect(answers).resolves.toEqual({ "Which?": "A" });
      expect(ops).toEqual(expect.arrayContaining(["msg.upsertPart", "slice"]));
      expect(t.client.getSession("s1")!.pending.questions).toEqual([]);
    });

    it.each([
      ["stale", { requestId: "gone", answers: {} }],
      ["invalid", { requestId: "q1", answers: { "Not asked": "A" } }],
      ["invalid", { requestId: "q1", answers: { "Which?": 3 as unknown as string } }],
    ])("answerQuestion answers %s and leaves the question pending (%#)", async (code, args) => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "ask" });
      void t.one.session.handleAskUserQuestion({
        sessionId: "acp-s1",
        requestId: "q1",
        questions: [{ question: "Which?", options: [{ label: "A" }] }],
      });
      const { result } = await t.run({ name: "answerQuestion", sessionId: "s1", ...args });
      expect(result).toMatchObject({ ok: false, code });
      expect(t.client.getSession("s1")!.pending.questions).toHaveLength(1);
    });

    it("resolvePlan applies the decision synchronously so its ops precede the result", async () => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "plan it" });
      const decision = t.one.session.handlePlanProposalPermission(PLAN_REQUEST);
      await settle();
      const plan = t.client.getSession("s1")!.plan!;
      expect(plan.decision).toBe("pending");

      const { result, ops, order } = await t.run({
        name: "resolvePlan",
        sessionId: "s1",
        proposalId: plan.id,
        decision: "approve",
      });
      expect(result).toEqual({ ok: true, value: undefined });
      await decision;
      expect(ops).toEqual(expect.arrayContaining(["slice"]));
      expect(order.at(-1)).toBe("result");
      expect(t.client.getSession("s1")!.plan).toBeNull();
      expect(t.client.getSession("s1")!.pending.planPermission).toBe(false);
    });

    it.each([
      ["stale", { proposalId: "old-plan", decision: "approve" as const }],
      ["invalid", { proposalId: "PLAN", decision: "maybe" as never }],
      ["invalid", { proposalId: "PLAN", decision: "approve" as const, feedbackText: "extra" }],
    ])("resolvePlan answers %s and leaves the plan pending (%#)", async (code, args) => {
      const t = setup();
      t.one.backend.holdPrompt();
      await t.run({ name: "send", sessionId: "s1", text: "plan it" });
      void t.one.session.handlePlanProposalPermission(PLAN_REQUEST);
      await settle();
      const planId = t.client.getSession("s1")!.plan!.id;
      const { result } = await t.run({
        name: "resolvePlan",
        sessionId: "s1",
        ...args,
        proposalId: args.proposalId === "PLAN" ? planId : args.proposalId,
      });
      expect(result).toMatchObject({ ok: false, code });
      expect(t.client.getSession("s1")!.plan?.decision).toBe("pending");
    });

    it("answers invalid for an unknown command name", async () => {
      const t = setup();
      const result = await runCommand(
        { manager: t.manager, resolveNote: () => null, isKnownBackend: () => true },
        { name: "explode" } as unknown as Command
      );
      expect(result).toMatchObject({ ok: false, code: "invalid" });
    });

    it("answers failed with a generic message when session code throws", async () => {
      const t = setup();
      jest.spyOn(t.one.session, "sendPrompt").mockImplementation(() => {
        throw new Error("secret spawn args");
      });
      const { result } = await t.run({ name: "send", sessionId: "s1", text: "x" });
      expect(result).toEqual({
        ok: false,
        code: "failed",
        message: "The command could not be completed",
      });
    });
  });
});
