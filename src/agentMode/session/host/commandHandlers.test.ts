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
import { MethodUnsupportedError } from "@/agentMode/session/errors";
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
      ["invalid", { requestId: "q1", answers: undefined as never }],
      ["invalid", { requestId: "q1", answers: null as never }],
      ["invalid", { requestId: "q1", answers: ["A"] as never }],
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

    it("createSession creates a global session on the requested agent, seeded with the pick, and returns its id", async () => {
      const t = setup();
      const { result } = await t.run({
        name: "createSession",
        backendId: "codex",
        seedSelection: { baseModelId: "gpt-5", effort: "high" },
      });
      expect(result).toMatchObject({ ok: true, value: { sessionId: expect.any(String) } });
      expect(t.manager.calls.at(-1)).toEqual({
        method: "createSession",
        args: ["codex", "__global__", { baseModelId: "gpt-5", effort: "high" }],
      });
      const created = (result as { value: { sessionId: string } }).value.sessionId;
      expect(t.client.getHost()?.tabs.map((tab) => tab.id)).toContain(created);
    });

    it("createSession forwards an explicit project scope", async () => {
      const t = setup();
      await t.run({ name: "createSession", projectId: "known-project" });
      expect(t.manager.calls.at(-1)).toEqual({
        method: "createSession",
        args: [undefined, "known-project", undefined],
      });
    });

    it.each([
      ["an unknown agent", { name: "createSession", backendId: "mystery" }],
      ["a seed without a model id", { name: "createSession", seedSelection: { effort: null } }],
      [
        "a seed with a numeric effort",
        { name: "createSession", seedSelection: { baseModelId: "m", effort: 3 } },
      ],
      ["a non-string project scope", { name: "createSession", projectId: 7 }],
      [
        "a project id the desktop does not know https://github.com/Brevilabs/obsidian-copilot-private/issues/613",
        { name: "createSession", projectId: "deleted-project" },
      ],
    ])("createSession answers invalid for %s and creates nothing", async (_label, command) => {
      const t = setup();
      const { result } = await t.run(command as unknown as Command);
      expect(result).toMatchObject({ ok: false, code: "invalid" });
      expect(t.manager.calls).toEqual([]);
    });

    it("replaceSession swaps the tab's session and returns the replacement's id", async () => {
      const t = setup();
      const { result } = await t.run({
        name: "replaceSession",
        sessionId: "s1",
        backendId: "codex",
        preserveChatInput: true,
        seedSelection: { baseModelId: "gpt-5", effort: null },
      });
      expect(result).toMatchObject({ ok: true, value: { sessionId: expect.any(String) } });
      expect(t.manager.calls.at(-1)).toEqual({
        method: "replaceSessionInPlace",
        args: [
          "s1",
          "codex",
          { preserveChatInput: true, seedSelection: { baseModelId: "gpt-5", effort: null } },
        ],
      });
    });

    it("replaceSession drops the composer draft unless asked to preserve it", async () => {
      const t = setup();
      await t.run({ name: "replaceSession", sessionId: "s1" });
      expect(t.manager.calls.at(-1)?.args[2]).toMatchObject({ preserveChatInput: false });
    });

    it.each([
      ["unknown_session", { name: "replaceSession", sessionId: "nope" }],
      ["invalid", { name: "replaceSession", sessionId: "s1", backendId: "mystery" }],
    ])("replaceSession answers %s without touching the manager (%#)", async (code, command) => {
      const t = setup();
      const { result } = await t.run(command as unknown as Command);
      expect(result).toMatchObject({ ok: false, code });
      expect(t.manager.calls).toEqual([]);
    });

    it("closeTab takes the session out of the shared tab set and keeps it running", async () => {
      const t = setup();
      const { result } = await t.run({ name: "closeTab", sessionId: "s1" });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(t.client.getHost()?.tabs).toEqual([]);
      expect(t.manager.getSession("s1")).not.toBeNull();
    });

    it("openTab puts a closed tab's session back in the shared tab set", async () => {
      const t = setup();
      await t.run({ name: "closeTab", sessionId: "s1" });
      const { result } = await t.run({ name: "openTab", sessionId: "s1" });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(t.client.getHost()?.tabs.map((tab) => tab.id)).toEqual(["s1"]);
    });

    it.each(["openTab", "closeTab"] as const)(
      "%s answers unknown_session for a missing session",
      async (name) => {
        const t = setup();
        const { result } = await t.run({ name, sessionId: "nope" });
        expect(result).toMatchObject({ ok: false, code: "unknown_session" });
      }
    );

    it("renameSession sets the tab label and clears it with null", async () => {
      const t = setup();
      await t.run({ name: "renameSession", sessionId: "s1", label: "  Trip plan " });
      expect(t.client.getHost()?.tabs[0]).toMatchObject({
        label: "Trip plan",
        labelSource: "user",
      });
      await t.run({ name: "renameSession", sessionId: "s1", label: null });
      expect(t.client.getHost()?.tabs[0]).toMatchObject({ label: null, labelSource: null });
    });

    it.each([
      ["unknown_session", { name: "renameSession", sessionId: "nope", label: "x" }],
      ["invalid", { name: "renameSession", sessionId: "s1", label: 5 }],
    ])("renameSession answers %s and leaves the label alone (%#)", async (code, command) => {
      const t = setup();
      const { result } = await t.run(command as unknown as Command);
      expect(result).toMatchObject({ ok: false, code });
      expect(t.client.getHost()?.tabs[0].label).toBeNull();
    });

    it("applySelection on the session's own agent applies the model and effort to that session", async () => {
      const t = setup();
      const { result } = await t.run({
        name: "applySelection",
        sessionId: "s1",
        backendId: "claude",
        baseModelId: "opus",
        effort: "high",
      });
      expect(result).toEqual({ ok: true, value: { sessionId: "s1" } });
      expect(t.manager.calls.at(-1)).toEqual({
        method: "applySelectionTo",
        args: ["s1", { baseModelId: "opus", effort: "high" }],
      });
    });

    it("applySelection with only an effort changes the effort and leaves the model unset", async () => {
      const t = setup();
      await t.run({ name: "applySelection", sessionId: "s1", backendId: "claude", effort: null });
      expect(t.manager.calls.at(-1)).toEqual({
        method: "applySelectionTo",
        args: ["s1", { effort: null }],
      });
    });

    it("applySelection to another agent's model replaces the session in place, keeping the draft and seeding the pick https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const t = setup();
      const { result } = await t.run({
        name: "applySelection",
        sessionId: "s1",
        backendId: "codex",
        baseModelId: "gpt-5",
      });
      expect(result).toMatchObject({ ok: true, value: { sessionId: expect.any(String) } });
      expect((result as { value: { sessionId: string } }).value.sessionId).not.toBe("s1");
      expect(t.manager.calls.at(-1)).toEqual({
        method: "replaceSessionInPlace",
        args: [
          "s1",
          "codex",
          { preserveChatInput: true, seedSelection: { baseModelId: "gpt-5", effort: null } },
        ],
      });
    });

    it("applySelection to another agent's model answers stale and keeps the chat when the session already has messages https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const t = setup();
      await t.run({ name: "send", sessionId: "s1", text: "hello" });
      t.manager.calls.length = 0;
      const { result } = await t.run({
        name: "applySelection",
        sessionId: "s1",
        backendId: "codex",
        baseModelId: "gpt-5",
      });
      expect(result).toMatchObject({ ok: false, code: "stale" });
      expect(t.manager.calls).toEqual([]);
    });

    it("applySelection with only an effort for another agent answers stale https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const t = setup();
      const { result } = await t.run({
        name: "applySelection",
        sessionId: "s1",
        backendId: "codex",
        effort: "low",
      });
      expect(result).toMatchObject({ ok: false, code: "stale" });
      expect(t.manager.calls).toEqual([]);
    });

    it("applySelection answers unsupported when the agent cannot switch while running", async () => {
      const t = setup();
      t.manager.applyFailure = new MethodUnsupportedError("session/set_model");
      const { result } = await t.run({
        name: "applySelection",
        sessionId: "s1",
        backendId: "claude",
        baseModelId: "opus",
      });
      expect(result).toMatchObject({ ok: false, code: "unsupported" });
    });

    it.each([
      ["unknown_session", { sessionId: "nope", backendId: "claude", baseModelId: "m" }],
      ["invalid", { sessionId: "s1", backendId: "mystery", baseModelId: "m" }],
      ["invalid", { sessionId: "s1", backendId: "claude" }],
      ["invalid", { sessionId: "s1", backendId: "claude", baseModelId: "" }],
      ["invalid", { sessionId: "s1", backendId: "claude", baseModelId: 4 }],
      ["invalid", { sessionId: "s1", backendId: "claude", baseModelId: "m", effort: 4 }],
    ])("applySelection answers %s and applies nothing (%#)", async (code, args) => {
      const t = setup();
      const { result } = await t.run({ name: "applySelection", ...args } as unknown as Command);
      expect(result).toMatchObject({ ok: false, code });
      expect(t.manager.calls).toEqual([]);
    });

    it("applyMode applies a mode the session's agent reported", async () => {
      const t = setup();
      jest.spyOn(t.one.session, "getState").mockReturnValue({
        model: null,
        mode: {
          current: "default",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      });
      const { result } = await t.run({ name: "applyMode", sessionId: "s1", mode: "plan" });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(t.manager.calls.at(-1)).toEqual({ method: "applyModeTo", args: ["s1", "plan"] });
    });

    it.each([
      ["unknown_session", "nope", "plan"],
      ["invalid", "s1", "auto"],
      ["invalid", "s1", "yolo"],
    ])(
      "applyMode answers %s when the session or mode is not available (%#)",
      async (code, sessionId, mode) => {
        const t = setup();
        jest.spyOn(t.one.session, "getState").mockReturnValue({
          model: null,
          mode: {
            current: "default",
            options: [{ value: "plan", label: "Plan" }],
            apply: { plan: { kind: "setMode", nativeId: "plan" } },
          },
        });
        const { result } = await t.run({
          name: "applyMode",
          sessionId,
          mode: mode as "plan",
        });
        expect(result).toMatchObject({ ok: false, code });
        expect(t.manager.calls).toEqual([]);
      }
    );

    it("answers invalid for an unknown command name", async () => {
      const t = setup();
      const result = await runCommand(
        {
          manager: t.manager,
          resolveNote: () => null,
          isKnownBackend: () => true,
          isKnownProject: () => true,
        },
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
