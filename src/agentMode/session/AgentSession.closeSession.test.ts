import { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { BackendProcess, BackendState } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(() => ({ agentMode: {} })) }));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

// Isolate close lifecycle from the legacy session suite's model/fan-out setup.
function makeMockBackend() {
  const prompt = jest.fn(async () => ({ stopReason: "end_turn" as const }));
  const cancel = jest.fn(async () => undefined);
  const newSession = jest.fn(
    async (): Promise<{ sessionId: string; state: BackendState }> => ({
      sessionId: "acp-1",
      state: { model: null, mode: null },
    })
  );
  const asBackend = {
    prompt,
    cancel,
    newSession,
    registerSessionHandler: jest.fn(() => () => {}),
  } as unknown as BackendProcess;
  return { asBackend, prompt, cancel, newSession };
}

describe("AgentSession", () => {
  describe("AgentSession", () => {
    describe("releaseBackendSession()", () => {
      function setup() {
        const mock = makeMockBackend();
        const close = jest
          .fn<Promise<void>, [{ sessionId: string }]>()
          .mockResolvedValue(undefined);
        mock.asBackend.closeSession = close;
        const session = new AgentSession({
          backend: mock.asBackend,
          backendSessionId: "acp-1",
          internalId: "internal-1",
          backendId: "opencode",
        });
        return { mock, close, session };
      }

      it("blocks new sends before awaiting release and preserves messages through disposal https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const { session, mock, close } = setup();
        await session.sendPrompt("saved conversation").turn;
        const messages = session.store.getDisplayMessages();
        let finish!: () => void;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        close.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
              markStarted();
            })
        );
        const release = session.releaseBackendSession();
        expect(() => session.sendPrompt("racing send")).toThrow("Session is closing");
        await started;
        expect(close).toHaveBeenCalledWith({ sessionId: "acp-1" });
        expect(() => session.sendPrompt("during close")).toThrow("Session is closing");
        expect(mock.prompt).toHaveBeenCalledTimes(1);
        expect(session.store.getDisplayMessages()).toEqual(messages);
        finish();
        await release;
        expect(() => session.sendPrompt("after release")).toThrow("Session is closing");
        await session.dispose();
        expect(session.getStatus()).toBe("closed");
        expect(session.store.getDisplayMessages()).toEqual(messages);
      });

      it("rejects a duplicate close without reopening sending or issuing another RPC https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const { session, close } = setup();
        let finish!: () => void;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        close
          .mockImplementationOnce(() => {
            markStarted();
            return pending;
          })
          .mockRejectedValue(new Error("duplicate RPC"));
        const first = session.releaseBackendSession();
        await started;
        const second = session.releaseBackendSession();
        try {
          await expect(second).rejects.toThrow("Session is already closing");
          expect(close).toHaveBeenCalledTimes(1);
          expect(() => session.sendPrompt("duplicate close race")).toThrow("Session is closing");
        } finally {
          finish();
          await first;
        }
        expect(() => session.sendPrompt("released session")).toThrow("Session is closing");
      });

      it("waits for startup before releasing its new backend session https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mock = makeMockBackend();
        const close = jest.fn().mockResolvedValue(undefined);
        mock.asBackend.closeSession = close;
        let finish!: (result: { sessionId: string; state: BackendState }) => void;
        mock.newSession.mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve;
          })
        );
        const session = AgentSession.start({
          backend: mock.asBackend,
          cwd: "/vault",
          internalId: "internal-1",
          backendId: "opencode",
        });
        const release = session.releaseBackendSession();
        expect(close).not.toHaveBeenCalled();
        expect(() => session.sendPrompt("during startup")).toThrow("Session is closing");
        finish({ sessionId: "new-backend-session", state: { model: null, mode: null } });
        await release;
        expect(close).toHaveBeenCalledWith({ sessionId: "new-backend-session" });
      });

      it("allows disposal after failed startup without a backend close request https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mock = makeMockBackend();
        const close = jest.fn().mockResolvedValue(undefined);
        mock.asBackend.closeSession = close;
        mock.newSession.mockRejectedValueOnce(new Error("startup failed"));
        const session = AgentSession.start({
          backend: mock.asBackend,
          cwd: "/vault",
          internalId: "internal-1",
          backendId: "opencode",
        });
        await session.releaseBackendSession();
        await session.dispose();
        expect(close).not.toHaveBeenCalled();
        expect(session.getStatus()).toBe("closed");
      });

      it("restores sending when backend release fails https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const { session, close } = setup();
        close.mockRejectedValueOnce(new Error("backend busy"));
        await expect(session.releaseBackendSession()).rejects.toThrow("backend busy");
        await expect(session.sendPrompt("try again").turn).resolves.toBe("end_turn");
      });

      it.each(["missing", "unsupported"])(
        "explains %s close support and restores sending https://github.com/Brevilabs/obsidian-copilot-private/issues/429",
        async (kind) => {
          const { session, mock, close } = setup();
          if (kind === "missing") delete mock.asBackend.closeSession;
          else close.mockRejectedValueOnce(new MethodUnsupportedError("session/close"));
          await expect(session.releaseBackendSession()).rejects.toThrow(
            "This agent does not support closing individual sessions."
          );
          await expect(session.sendPrompt("still usable").turn).resolves.toBe("end_turn");
        }
      );
    });
  });
});
