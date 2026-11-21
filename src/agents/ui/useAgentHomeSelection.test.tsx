import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { fakeAgentStore } from "@/agents/ui/testing/fakeAgentStore";
import {
  agentComposerHint,
  useAgentHomeSelection,
  type AgentHomeChat,
} from "@/agents/ui/useAgentHomeSelection";
import { logError } from "@/logger";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { act, renderHook } from "@testing-library/react";
import { Notice } from "obsidian";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/588";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const PROFILE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";

function agent(slug: string, name: string): CustomAgent {
  return {
    slug,
    name,
    title: `${name}'s job`,
    faceSrc: `face:${slug}`,
    model: { baseModelId: "haiku", effort: "low" },
  } as CustomAgent;
}

const COCO = agent("coco", "Coco");
const MAYA = agent("maya", "Maya");

const NEW_CHAT: AgentHomeChat = {
  sessionId: "session-1",
  chatInputId: "input-1",
  agentSlug: null,
  isLanding: true,
};

const ALL_RUN_HERE: ReadonlySet<string> = new Set();

function renderSelection(
  store: CustomAgentStore,
  chat: AgentHomeChat = NEW_CHAT,
  switchAgent: (agent: CustomAgent | null) => Promise<void> = jest.fn(() => new Promise(() => {})),
  needsSetup: ReadonlySet<string> = ALL_RUN_HERE
) {
  const hook = renderHook(
    (props: { current: AgentHomeChat; needsSetup?: ReadonlySet<string> }) =>
      useAgentHomeSelection(store, props.current, switchAgent, props.needsSetup ?? needsSetup),
    { initialProps: { current: chat } }
  );
  return { ...hook, switchAgent };
}

function rememberLastAgent(slug: string | undefined) {
  setSettings((cur) => ({ agentMode: { ...cur.agentMode, lastTeammate: slug } }));
}

describe("useAgentHomeSelection", () => {
  beforeEach(async () => {
    resetSettings();
    await setCustomAgentsAccess("team");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("useAgentHomeSelection()", () => {
    it("lists the agents and selects Copilot on a new chat when the last chat started was a Copilot chat", () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store);

      expect(result.current.agents).toEqual([COCO, MAYA]);
      expect(result.current.selected).toBeNull();
      expect(switchAgent).not.toHaveBeenCalled();
    });

    it(`selects the agent of the last chat started and switches the new chat to it (${ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store);

      expect(switchAgent).toHaveBeenCalledWith(MAYA);
      expect(result.current.selected).toBe(MAYA);
    });

    it(`keeps Copilot when the agent of the last chat started no longer exists (${ISSUE})`, () => {
      rememberLastAgent("gone");
      const { store } = fakeAgentStore([COCO]);
      const { result, switchAgent } = renderSelection(store);

      expect(result.current.selected).toBeNull();
      expect(switchAgent).not.toHaveBeenCalled();
    });

    it(`keeps the agent a new chat was started with, as by the start-a-chat command, over the last chat's agent (${ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" });

      expect(switchAgent).not.toHaveBeenCalled();
      expect(result.current.selected).toBe(COCO);
    });

    it(`switches to the last chat's agent once the agents load after the home opened (${ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store, publish } = fakeAgentStore([]);
      const { result, switchAgent } = renderSelection(store);
      expect(switchAgent).not.toHaveBeenCalled();

      publish([COCO, MAYA]);

      expect(switchAgent).toHaveBeenCalledWith(MAYA);
      expect(result.current.selected).toBe(MAYA);
    });

    it(`keeps the user's pick on that new chat when the agents change later (${ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store);

      act(() => void result.current.select(null));
      publish([COCO, MAYA, agent("leo", "Leo")]);

      expect(jest.mocked(switchAgent).mock.calls).toEqual([[MAYA], [null]]);
      expect(result.current.selected).toBeNull();
    });

    it(`moves a new chat back to Copilot once when its agent's folder is deleted before the first message (${ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store, { ...NEW_CHAT, agentSlug: "maya" });
      expect(switchAgent).not.toHaveBeenCalled();

      publish([COCO]);
      publish([COCO, agent("leo", "Leo")]);

      expect(jest.mocked(switchAgent).mock.calls).toEqual([[null]]);
      expect(result.current.selected).toBeNull();
    });

    it(`moves a new chat on an agent back to Copilot once the license check locks custom agents (${LOCKED_ISSUE})`, async () => {
      rememberLastAgent("maya");
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { rerender, switchAgent } = renderSelection(store);
      expect(switchAgent).toHaveBeenLastCalledWith(MAYA);

      await act(() => setCustomAgentsAccess("free"));
      rerender({ current: { ...NEW_CHAT, agentSlug: "maya" } });

      expect(switchAgent).toHaveBeenLastCalledWith(null);
    });

    it(`keeps Copilot on a new chat instead of the last chat's agent when that agent's model can't run on this device (${SETUP_ISSUE})`, () => {
      rememberLastAgent("maya");
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(
        store,
        NEW_CHAT,
        undefined,
        new Set(["maya"])
      );

      expect(switchAgent).not.toHaveBeenCalled();
      expect(result.current.selected).toBeNull();
    });

    it(`moves a new chat on an agent back to Copilot once that agent's model can't run on this device (${SETUP_ISSUE})`, () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const chat = { ...NEW_CHAT, agentSlug: "maya" };
      const { rerender, switchAgent } = renderSelection(store, chat);
      expect(switchAgent).not.toHaveBeenCalled();

      rerender({ current: chat, needsSetup: new Set(["maya"]) });

      expect(switchAgent).toHaveBeenLastCalledWith(null);
    });

    it("switches the new chat to a picked agent and shows it as selected right away", () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store);

      act(() => void result.current.select("coco"));

      expect(switchAgent).toHaveBeenCalledWith(COCO);
      expect(result.current.selected).toBe(COCO);
    });

    it("switches the new chat to an agent the store lists before the home re-renders, such as one just created, for https://github.com/Brevilabs/obsidian-copilot-private/issues/939", () => {
      const KAI = agent("kai", "Kai");
      let listed: readonly CustomAgent[] = [COCO];
      const store = {
        subscribe: () => () => {},
        getAgents: () => listed,
      } as unknown as CustomAgentStore;
      const { result, switchAgent } = renderSelection(store);
      const selectFromLastRender = result.current.select;

      listed = [COCO, KAI];
      act(() => void selectFromLastRender("kai"));

      expect(switchAgent).toHaveBeenCalledWith(KAI);
    });

    it("shows the chat's own agent once the switch has landed", async () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, rerender } = renderSelection(store, NEW_CHAT, () => Promise.resolve());

      await act(() => result.current.select("coco"));
      rerender({ current: { ...NEW_CHAT, sessionId: "session-2", agentSlug: "coco" } });

      expect(result.current.selected).toBe(COCO);
    });

    it.each([
      ["model", { model: { baseModelId: "sonnet", effort: "low" } }],
      ["effort", { model: { baseModelId: "haiku", effort: "medium" } }],
      ["name", { name: "Cocoa" }],
    ] as const)(
      `rebuilds a new chat on its picked agent when that agent's %s changes before the first message, so the chat starts as the agent now is (${PROFILE_ISSUE})`,
      async (_, change) => {
        const { store, publish } = fakeAgentStore([COCO, MAYA]);
        const switchAgent = jest.fn(() => Promise.resolve());
        const { result, rerender } = renderSelection(store, NEW_CHAT, switchAgent);
        await act(() => result.current.select("coco"));
        rerender({ current: { ...NEW_CHAT, sessionId: "session-2", agentSlug: "coco" } });

        const changed = { ...COCO, ...change } as CustomAgent;
        publish([changed, MAYA]);

        expect(switchAgent.mock.calls).toEqual([[COCO], [changed]]);
      }
    );

    it(`rebuilds a new chat started on an agent, as by the start-a-chat command, when that agent changes (${PROFILE_ISSUE})`, () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { switchAgent } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" });

      const changed = { ...COCO, model: { baseModelId: "sonnet", effort: null } } as CustomAgent;
      publish([changed, MAYA]);

      expect(jest.mocked(switchAgent).mock.calls).toEqual([[changed]]);
    });

    it(`rebuilds a new chat in another tab when the user comes back to it after its agent changed (${PROFILE_ISSUE})`, () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const newCoco = { ...NEW_CHAT, agentSlug: "coco" };
      const { rerender, switchAgent } = renderSelection(store, newCoco);
      rerender({
        current: { sessionId: "other", chatInputId: "input-2", agentSlug: null, isLanding: false },
      });

      const changed = { ...COCO, model: { baseModelId: "sonnet", effort: null } } as CustomAgent;
      publish([changed, MAYA]);
      expect(switchAgent).not.toHaveBeenCalled();
      rerender({ current: newCoco });

      expect(jest.mocked(switchAgent).mock.calls).toEqual([[changed]]);
    });

    it(`moves a new chat to Copilot and says why, without trying again, when its agent changes to a model whose chat cannot start (${PROFILE_ISSUE})`, async () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      let fellBack!: () => void;
      const fallback = new Promise<void>((resolve) => (fellBack = resolve));
      const switchAgent = jest.fn((agent: CustomAgent | null) => {
        if (agent) return Promise.reject(new Error("OpenCode isn't set up."));
        fellBack();
        return Promise.resolve();
      });
      const { rerender } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" }, switchAgent);

      const changed = { ...COCO, model: { baseModelId: "opencode/beam-free", effort: null } };
      publish([changed, MAYA]);
      await act(() => fallback);
      rerender({ current: { ...NEW_CHAT, sessionId: "session-2", agentSlug: null } });
      publish([{ ...changed, name: "Cocoa" }, MAYA]);

      expect(switchAgent.mock.calls).toEqual([[changed], [null]]);
      expect(Notice).toHaveBeenCalledWith(
        "Couldn't start a chat with Coco. OpenCode isn't set up."
      );
    });

    it(`leaves a new chat as it is when only its agent's face changes, so a model picked for that chat stays (${PROFILE_ISSUE})`, () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { switchAgent } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" });

      publish([{ ...COCO, faceSrc: "face:coco?2" }, MAYA]);

      expect(switchAgent).not.toHaveBeenCalled();
    });

    it("leaves a new chat as it is when only another agent changes", () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { switchAgent } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" });

      publish([COCO, { ...MAYA, name: "Maia" }]);

      expect(switchAgent).not.toHaveBeenCalled();
    });

    it("keeps a chat under way on the agent as it started when that agent changes", () => {
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { switchAgent } = renderSelection(store, {
        ...NEW_CHAT,
        agentSlug: "coco",
        isLanding: false,
      });

      publish([{ ...COCO, model: { baseModelId: "sonnet", effort: null } }, MAYA]);

      expect(switchAgent).not.toHaveBeenCalled();
    });

    it(`reports the new chat as switching from the pick until the picked agent's chat has started, so a message sent meanwhile waits for that agent (${ISSUE})`, async () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      let started!: () => void;
      const switchAgent = jest.fn(() => new Promise<void>((resolve) => (started = resolve)));
      const { result } = renderSelection(store, NEW_CHAT, switchAgent);
      expect(result.current.switching).toBe(false);

      let pick!: Promise<void>;
      act(() => {
        pick = result.current.select("coco");
      });
      expect(result.current.switching).toBe(true);

      await act(async () => {
        started();
        await pick;
      });
      expect(result.current.switching).toBe(false);
    });

    it(`moves the new chat to Copilot and says why when the picked agent's chat cannot start (${ISSUE})`, async () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const switchAgent = jest.fn((agent: CustomAgent | null) =>
        agent
          ? Promise.reject(new Error("Codex needs an update to run Copilot Teammates."))
          : Promise.resolve()
      );
      const { result } = renderSelection(store, NEW_CHAT, switchAgent);

      await act(() => result.current.select("coco"));

      expect(switchAgent.mock.calls).toEqual([[COCO], [null]]);
      expect(result.current.selected).toBeNull();
      expect(logError).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "Couldn't start a chat with Coco. Codex needs an update to run Copilot Teammates."
      );
    });

    it(`keeps a later pick when an earlier pick's chat fails to start (${ISSUE})`, async () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      let failCoco!: (error: Error) => void;
      const switchAgent = jest.fn((agent: CustomAgent | null) =>
        agent === COCO ? new Promise<void>((_, reject) => (failCoco = reject)) : Promise.resolve()
      );
      const { result, rerender } = renderSelection(store, NEW_CHAT, switchAgent);

      let coco!: Promise<void>;
      act(() => {
        coco = result.current.select("coco");
      });
      await act(() => result.current.select("maya"));
      rerender({ current: { ...NEW_CHAT, sessionId: "session-2", agentSlug: "maya" } });
      await act(async () => {
        failCoco(new Error("backend down"));
        await coco;
      });

      expect(switchAgent.mock.calls).toEqual([[COCO], [MAYA]]);
      expect(result.current.selected).toBe(MAYA);
    });

    it("says why when a chat cannot start on Copilot either, without trying again", async () => {
      const { store } = fakeAgentStore([COCO]);
      const failing = jest.fn(() => Promise.reject(new Error("Codex isn't set up.")));
      const { result } = renderSelection(store, { ...NEW_CHAT, agentSlug: "coco" }, failing);

      await act(() => result.current.select(null));

      expect(failing).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith(
        "Couldn't start a chat with Copilot. Codex isn't set up."
      );
      expect(result.current.selected).toBe(COCO);
    });

    it(`remembers the chat's agent when its first message starts the chat (${ISSUE})`, () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const coco = { ...NEW_CHAT, agentSlug: "coco" };
      const { rerender } = renderSelection(store, coco);

      rerender({ current: { ...coco, isLanding: false } });

      expect(getSettings().agentMode.lastTeammate).toBe("coco");
    });

    it("remembers Copilot when a Copilot chat is started", () => {
      rememberLastAgent("gone");
      const { store } = fakeAgentStore([COCO]);
      const { rerender } = renderSelection(store);

      rerender({ current: { ...NEW_CHAT, isLanding: false } });

      expect(getSettings().agentMode.lastTeammate).toBeUndefined();
    });

    it("remembers nothing when the home opens a saved chat", () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { rerender } = renderSelection(store);

      rerender({
        current: {
          sessionId: "saved",
          chatInputId: "input-2",
          agentSlug: "maya",
          isLanding: false,
        },
      });

      expect(getSettings().agentMode.lastTeammate).toBeUndefined();
    });

    it("selects the agent of a chat already under way", () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, switchAgent } = renderSelection(store, {
        ...NEW_CHAT,
        agentSlug: "coco",
        isLanding: false,
      });

      expect(result.current.selected).toBe(COCO);
      expect(switchAgent).not.toHaveBeenCalled();
    });

    it("shows the chat's own agent, not a pick still starting, once a message sent on the new chat has started it, for https://github.com/Brevilabs/obsidian-copilot-private/issues/938", () => {
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, rerender } = renderSelection(store);
      act(() => void result.current.select("maya"));
      expect(result.current.selected).toBe(MAYA);

      rerender({ current: { ...NEW_CHAT, isLanding: false } });

      expect(result.current.selected).toBeNull();
    });

    it("shows no agent, and leaves the chat as it is, for a chat under way whose agent's folder is gone, for https://github.com/Brevilabs/obsidian-copilot-private/issues/938", () => {
      const { store } = fakeAgentStore([MAYA]);
      const { result, switchAgent } = renderSelection(store, {
        ...NEW_CHAT,
        agentSlug: "coco",
        isLanding: false,
      });

      expect(result.current.selected).toBeNull();
      expect(switchAgent).not.toHaveBeenCalled();
    });

    it(`lists no agents, switches nothing and remembers nothing while the stored license token awaits verification (${ISSUE})`, async () => {
      await setCustomAgentsAccess("unverified");
      rememberLastAgent("maya");
      const { store } = fakeAgentStore([COCO, MAYA]);
      const { result, rerender, switchAgent } = renderSelection(store, {
        ...NEW_CHAT,
        agentSlug: "coco",
      });

      rerender({ current: { ...NEW_CHAT, agentSlug: "coco", isLanding: false } });

      expect(result.current.agents).toEqual([]);
      expect(result.current.selected).toBeNull();
      expect(switchAgent).not.toHaveBeenCalled();
      expect(getSettings().agentMode.lastTeammate).toBe("maya");
    });
  });

  describe("agentComposerHint()", () => {
    it("asks the user to ask the agent by name", () => {
      expect(agentComposerHint(COCO)).toBe("Ask Coco anything • @ to add context • / for commands");
    });

    it("leaves the composer's own hint for Copilot", () => {
      expect(agentComposerHint(null)).toBeUndefined();
    });
  });
});
