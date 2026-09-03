import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { SessionId } from "@/agentMode/session/types";

/**
 * Session double exposing only what the state under test reads: the status and
 * whether a backend session was ever opened.
 */
function makeSession(status: AgentSessionStatus, backendSessionId: SessionId | null): AgentSession {
  return {
    getStatus: () => status,
    getBackendSessionId: () => backendSessionId,
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

describe("AgentChatUIState", () => {
  describe("AgentChatUIState", () => {
    describe("canAcceptPrompt()", () => {
      it("accepts a prompt on an idle chat", () => {
        const state = new AgentChatUIState(makeSession("idle", "backend-1"));

        expect(state.canAcceptPrompt()).toBe(true);
      });

      it.each([
        ["still starting", "starting" as const],
        ["running a turn", "running" as const],
        ["awaiting a permission answer", "awaiting_permission" as const],
        ["closed", "closed" as const],
      ])("refuses a prompt while %s", (_case, status) => {
        const state = new AgentChatUIState(makeSession(status, "backend-1"));

        expect(state.canAcceptPrompt()).toBe(false);
      });

      it("accepts a retry after a turn failed on a live backend session for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        // A network, rate-limit, or auth failure reports "error" while the
        // backend session stays open; refusing here would strand the chat.
        const state = new AgentChatUIState(makeSession("error", "backend-1"));

        expect(state.canAcceptPrompt()).toBe(true);
      });

      it("refuses a prompt when startup failed and no backend session exists for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        const state = new AgentChatUIState(makeSession("error", null));

        expect(state.canAcceptPrompt()).toBe(false);
      });
    });
  });
});
