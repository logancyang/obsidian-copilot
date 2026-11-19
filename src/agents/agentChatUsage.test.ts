import { countAgentChatUse } from "@/agents/agentChatUsage";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import type { AgentSession, AgentSessionListener } from "@/agentMode/session/AgentSession";
import * as obsidianModule from "obsidian";
import { App } from "obsidian";

jest.mock("@/entitlement");

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/594";

const AGENT_NAME = "Quillfeather Vantablack";
const AGENT_INSTRUCTION = "Always answer in iambic pentameter about zebra-striped teapots.";
const MESSAGE = "Summarize Projects/Secret Harbor/plan.md for me";

interface LicenseRequest {
  url: string;
  body: string;
}

interface FakeChat {
  session: Pick<AgentSession, "subscribe">;
  sendMessage(): void;
}

function fakeChat(): FakeChat {
  const listeners = new Set<AgentSessionListener>();
  const session = {
    agentSlug: "quillfeather",
    agent: { name: AGENT_NAME, prompt: AGENT_INSTRUCTION },
    messages: [MESSAGE],
    subscribe: (listener: AgentSessionListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    session,
    sendMessage: () => listeners.forEach((listener) => listener.onPromptSent?.()),
  };
}

function holdLicenseChecks(): jest.Mock {
  const requestUrl = jest.fn(() => new Promise(() => undefined));
  setRequestUrlImpl(requestUrl);
  return requestUrl;
}

function sentBodies(requestUrl: jest.Mock): string[] {
  return requestUrl.mock.calls.map(([request]: [LicenseRequest]) => request.body);
}

describe("agentChatUsage", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await setCustomAgentsAccess("team");
  });

  describe("countAgentChatUse()", () => {
    it(`sends one license check with trigger custom_agents to /license when the chat's first message is sent, without waiting for its answer (${ISSUE})`, () => {
      const requestUrl = holdLicenseChecks();
      const chat = fakeChat();
      countAgentChatUse(new App(), chat.session);

      chat.sendMessage();

      expect(requestUrl).toHaveBeenCalledTimes(1);
      const [request] = requestUrl.mock.calls[0] as [LicenseRequest];
      expect(new URL(request.url).pathname).toMatch(/\/license$/);
      expect(JSON.parse(request.body)).toMatchObject({ trigger: "custom_agents" });
    });

    it(`sends nothing while the chat is only opened or restored and no message is sent (${ISSUE})`, () => {
      const requestUrl = holdLicenseChecks();

      countAgentChatUse(new App(), fakeChat().session);

      expect(requestUrl).not.toHaveBeenCalled();
    });

    it(`sends no further check for later messages in the same chat, keeping within the /license rate limit (${ISSUE})`, () => {
      const requestUrl = holdLicenseChecks();
      const chat = fakeChat();
      countAgentChatUse(new App(), chat.session);

      chat.sendMessage();
      chat.sendMessage();
      chat.sendMessage();

      expect(requestUrl).toHaveBeenCalledTimes(1);
    });

    it(`counts each chat once, so two agent chats send two checks (${ISSUE})`, () => {
      const requestUrl = holdLicenseChecks();
      const first = fakeChat();
      const second = fakeChat();
      countAgentChatUse(new App(), first.session);
      countAgentChatUse(new App(), second.session);

      first.sendMessage();
      second.sendMessage();
      first.sendMessage();

      expect(requestUrl).toHaveBeenCalledTimes(2);
    });

    it(`sends only the license key, the install's user id and the trigger: never the agent's name, instruction or the message (${ISSUE})`, () => {
      const requestUrl = holdLicenseChecks();
      const chat = fakeChat();
      countAgentChatUse(new App(), chat.session);

      chat.sendMessage();

      const [body] = sentBodies(requestUrl);
      expect(JSON.parse(body)).toEqual({
        license_key: "license-key",
        user_id: "user-1",
        trigger: "custom_agents",
      });
      for (const content of [AGENT_NAME, AGENT_INSTRUCTION, MESSAGE, "quillfeather"]) {
        expect(body).not.toContain(content);
      }
    });

    it(`sends nothing for an install without a license key (${ISSUE})`, async () => {
      await setCustomAgentsAccess("keyless");
      const requestUrl = holdLicenseChecks();
      const chat = fakeChat();
      countAgentChatUse(new App(), chat.session);

      chat.sendMessage();

      expect(requestUrl).not.toHaveBeenCalled();
    });
  });
});
