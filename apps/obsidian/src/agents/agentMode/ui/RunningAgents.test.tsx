import { createMemorySessionIndex } from "@/agentMode/session/testing/memorySessionIndex";
import { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import type { AgentMention } from "@/agents/agentMentions";
import { HiddenAgentChats, type HiddenChatStart } from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import {
  runningAgentsSlot,
  chatRunningAgents,
  type RunningAgent,
} from "@/agents/agentMode/ui/RunningAgents";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import type { CustomAgentsGate } from "@/agents/customAgentsGate";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setSettings } from "@/settings/model";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const NOW = Date.parse("2026-11-16T10:05:12Z");

function run(change: Partial<AgentMention> = {}): AgentMention {
  return {
    id: "run-leo",
    agent: "leo",
    name: "Leo",
    status: "working",
    startedAt: NOW - 3 * 60_000 - 12_000,
    ...change,
  };
}

function asked(change: Partial<AgentMention> = {}, message = "Reconcile October"): RunningAgent {
  return { mention: run(change), message, faceSrc: "data:image/png;base64,AA==" };
}

function renderLine(
  slot: ReturnType<typeof runningAgentsSlot>,
  tasks: readonly AgentTask[] = []
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <RunningTasksIndicator
        tasks={tasks}
        permissions={[]}
        onOpenTask={() => {}}
        defaultOpen
        runs={slot}
      />
    </TooltipProvider>
  );
}

describe("RunningAgents", () => {
  beforeEach(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  describe("runningAgentsSlot()", () => {
    const onOpen = jest.fn();
    it(`gives nothing to draw when no asked agent runs (${ISSUE})`, () => {
      expect(runningAgentsSlot({ runs: [], taskCount: 1, onOpen })).toBeUndefined();
    });

    it(`says the one working agent is working, with no clock on the line or its row, and lists it with what it was asked (${CARDS})`, () => {
      renderLine(runningAgentsSlot({ runs: [asked()], taskCount: 0, onOpen }));

      expect(screen.getByRole("button", { name: "Leo is working" }).textContent).toBe(
        "Leo is working"
      );
      const row = screen.getByText("Reconcile October").closest("li")!;
      expect(row.textContent).toBe("Leo Reconcile October");
    });

    it(`puts the waiting agent first in orange, face and words, and its row says it waits instead of a clock (${ISSUE})`, () => {
      renderLine(
        runningAgentsSlot({
          runs: [
            { ...asked({ id: "run-maya", agent: "maya", name: "Maya" }), faceSrc: "face:maya" },
            { ...asked({ status: "question" }), faceSrc: "face:leo" },
          ],
          taskCount: 0,
          onOpen,
        })
      );

      const line = screen.getByRole("button", { name: "Leo is waiting for you · Maya is working" });
      expect(line.querySelector(".tw-text-warning")).not.toBeNull();
      expect(
        Array.from(line.querySelectorAll("img")).map((face) => face.getAttribute("src"))
      ).toEqual(["face:leo", "face:maya"]);
      expect(screen.getByText("Waiting for you").classList.contains("tw-text-warning")).toBe(true);
    });

    it(`says a row waits on the user's OK when the agent asked for permission (${ISSUE})`, () => {
      renderLine(
        runningAgentsSlot({ runs: [asked({ status: "permission" })], taskCount: 0, onOpen })
      );

      expect(screen.getByRole("button", { name: "Leo needs your OK" })).toBeTruthy();
      expect(screen.getByText("Needs your OK")).toBeTruthy();
    });

    it(`counts the chat's own tasks after the agents and lists their rows below the agents (${ISSUE})`, () => {
      renderLine(runningAgentsSlot({ runs: [asked()], taskCount: 1, onOpen }), [makeTask()]);

      expect(screen.getByRole("button", { name: "Leo is working · 1 task" })).toBeTruthy();
      const rows = Array.from(document.querySelectorAll("li")).map((li) => li.textContent);
      expect(rows[0]).toContain("Reconcile October");
      expect(rows[1]).toContain("Count words in Welcome");
    });

    it(`opens the agent's view from its row and closes the list (${ISSUE})`, () => {
      const open = jest.fn();
      renderLine(runningAgentsSlot({ runs: [asked()], taskCount: 0, onOpen: open }));

      fireEvent.click(screen.getByText("Reconcile October"));

      expect(open).toHaveBeenCalledWith(run());
      expect(screen.queryByText("Reconcile October")).toBeNull();
    });

    it(`offers a stop for each agent only when stopping is allowed, and stops that agent's run (${ISSUE})`, () => {
      const onStop = jest.fn();
      const { unmount } = renderLine(runningAgentsSlot({ runs: [asked()], taskCount: 0, onOpen }));
      expect(screen.queryByRole("button", { name: "Stop Leo" })).toBeNull();
      unmount();

      renderLine(runningAgentsSlot({ runs: [asked()], taskCount: 0, onOpen, onStop }));
      fireEvent.click(screen.getByRole("button", { name: "Stop Leo" }));

      expect(onStop).toHaveBeenCalledWith(run());
    });
  });

  describe("chatRunningAgents()", () => {
    let fake: FakeAgentBackend;
    let store: CustomAgentStore;
    let chats: HiddenAgentChats;
    let coco: AgentSession;
    let started: AgentSession[];

    const sessionIdOf = (session: AgentSession) => session.getBackendSessionId()!;

    const Line: React.FC<{ chat: AgentSession; gate?: CustomAgentsGate }> = ({
      chat,
      gate = "full",
    }) => {
      const runs = chatRunningAgents({
        messages: chat.store.getDisplayMessages(),
        chat,
        hiddenChats: chats,
        agents: store.getAgents(),
        taskCount: 0,
        onOpen: () => {},
        gate,
      });
      return (
        <TooltipProvider>
          <RunningTasksIndicator
            tasks={[]}
            permissions={[]}
            onOpenTask={() => {}}
            defaultOpen
            runs={runs}
          />
        </TooltipProvider>
      );
    };

    beforeEach(async () => {
      setSettings({ copilotFolder: "copilot" });
      await setCustomAgentsAccess("team");
      const vault = createFakeAgentVault();
      for (const [slug, name] of [
        ["coco", "Coco"],
        ["leo", "Leo"],
      ]) {
        vault.writeByHand(
          `copilot/teammates/${slug}/instructions.md`,
          serializeInstructionsFile({ name, title: `${name}'s title`, model: null }, "Help.")
        );
      }
      store = new CustomAgentStore(vault.app);
      await store.start();
      fake = createFakeAgentBackend();
      started = [];
      const startChat = async (start: HiddenChatStart) => {
        const session = AgentSession.start({
          backend: fake.backend,
          cwd: "/vault",
          internalId: `hidden-${started.length + 1}`,
          backendId: "fake",
          agentSlug: start.agent.slug,
          agent: start.prompt,
          observeSessionEvent: start.observeSessionEvent,
        });
        await session.ready;
        started.push(session);
        return session;
      };
      coco = new AgentSession({
        backend: fake.backend,
        cwd: "/vault",
        internalId: "coco-chat",
        backendId: "fake",
        agentSlug: "coco",
      });
      await coco.ready;
      chats = new HiddenAgentChats({
        store: () => store,
        vaultBase: () => "/vault",
        listedChat: (chat) => (chat === coco ? coco : null),
        unavailableReason: () => null,
        startChat,
        askedConversations: createMemorySessionIndex(),
      });
      coco.sendPrompt("@Leo reconcile October");
      await fake.untilPrompt(sessionIdOf(coco));
      chats.ask(coco, "Leo", "Reconcile October against the Mercury export.");
      fake.endTurn(sessionIdOf(coco));
      await fake.untilPrompt("session-2");
    });

    afterEach(() => {
      chats.dispose();
      store.stop();
    });

    it(`lists a run the plugin still holds, and leaves out a saved run whose agent no longer works (${ISSUE})`, () => {
      const asking = coco.store.getDisplayMessages()[0];
      coco.store.setAgentMentions(asking.id, [
        ...(asking.agentMentions ?? []),
        run({ id: "run-from-before", name: "Nora", agent: "nora" }),
      ]);

      render(<Line chat={coco} />);

      expect(screen.getByText("Reconcile October against the Mercury export.")).toBeTruthy();
      expect(screen.queryByText(/Nora/)).toBeNull();
    });

    it(`leaves out a run another chat holds, as in a chat continued from the asking one while its agent works (${ISSUE})`, async () => {
      const continued = new AgentSession({
        backend: fake.backend,
        cwd: "/vault",
        internalId: "continued-chat",
        backendId: "fake",
        agentSlug: "coco",
      });
      await continued.ready;

      const runs = chatRunningAgents({
        messages: coco.store.getDisplayMessages(),
        chat: continued,
        hiddenChats: chats,
        agents: store.getAgents(),
        taskCount: 0,
        onOpen: () => {},
        gate: "full",
      });

      expect(runs).toBeUndefined();
    });

    it(`stops the agent from its row without asking, and the chat's agent gets one turn with how far it got (${ISSUE})`, async () => {
      fake.say(sessionIdOf(started[0]), "Matched 120 of 214.");
      render(<Line chat={coco} />);

      fireEvent.click(screen.getByRole("button", { name: "Stop Leo" }));

      const relayed = await fake.untilPrompt(sessionIdOf(coco), 2);
      expect(relayed).toContain(
        "Leo stopped. The user already knows, so don't mention the stop; go straight to how far Leo got."
      );
      expect(relayed).toContain("Matched 120 of 214.");
      expect(coco.store.getDisplayMessages()[0].agentMentions?.[0]).toEqual(
        expect.objectContaining({ status: "stopped" })
      );
    });

    it(`shows a run that keeps working after the license stopped being valid, without a stop, since only a license that includes custom agents can act (${ISSUE})`, () => {
      render(<Line chat={coco} gate="locked" />);

      expect(screen.getByText("Reconcile October against the Mercury export.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Stop Leo" })).toBeNull();
    });
  });
});
