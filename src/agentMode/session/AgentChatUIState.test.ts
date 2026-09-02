import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";

describe("AgentChatUIState", () => {
  describe("AgentChatUIState", () => {
    describe("isBusy()", () => {
      it.each<AgentSessionStatus>(["starting", "running", "awaiting_permission"])(
        "reports %s as busy so command prompts queue for https://github.com/Brevilabs/obsidian-copilot-private/issues/357",
        (status) => {
          const session = {
            subscribe: jest.fn(),
            getStatus: () => status,
          } as unknown as AgentSession;

          expect(new AgentChatUIState(session).isBusy()).toBe(true);
        }
      );

      it.each<AgentSessionStatus>(["idle", "error", "closed"])(
        "reports %s as available for https://github.com/Brevilabs/obsidian-copilot-private/issues/357",
        (status) => {
          const session = {
            subscribe: jest.fn(),
            getStatus: () => status,
          } as unknown as AgentSession;

          expect(new AgentChatUIState(session).isBusy()).toBe(false);
        }
      );
    });
  });
});
