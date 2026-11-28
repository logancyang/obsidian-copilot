import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { startCustomAgentChat } from "@/agents/agentMode/agentChats";
import {
  AGENT_DRAFT_CARD,
  type AgentDraftCard as AgentDraftCardState,
} from "@/agents/agentMode/agentDraftCard";
import { AgentDraftCard, agentDraftCardSlot } from "@/agents/agentMode/ui/AgentDraftCard";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import type { FakeObsidianModal } from "@/agents/ui/testing/fakeObsidianModal";
import { CustomAgentStoreContext } from "@/agents/ui/useCustomAgents";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import type CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as obsidian from "obsidian";
import React from "react";

jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  Modal: jest.requireActual<typeof import("@/agents/ui/testing/fakeObsidianModal")>(
    "@/agents/ui/testing/fakeObsidianModal"
  ).FakeObsidianModal,
}));
jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/agentMode/backends/registry", () => ({ listBackendDescriptors: () => [] }));
jest.mock("@/agentMode/ui/agentModelPickerHelpers", () => ({
  buildAgentModelChoices: () => ({
    models: [{ name: "opus", displayName: "Opus 5.5", provider: "agent", enabled: true }],
    effortOptionsByModelKey: {},
    initial: { baseModelId: "opus", effort: null },
  }),
}));
jest.mock("@/agents/agentMode/agentChats", () => ({
  startCustomAgentChat: jest.fn(async () => ({})),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/941";
const NORA = {
  name: "Nora",
  title: "Family calendar and school logistics",
  instruction: "You handle our family logistics: school pickups and swim class.",
};
const COCO = { slug: "coco", name: "Coco", faceSrc: "app://coco.webp" } as CustomAgent;
const NORA_AGENT = { slug: "nora", name: "Nora", model: null } as unknown as CustomAgent;

(obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }).__setRequestUrlImpl(
  jest.fn(() => new Promise(() => {}))
);

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

function draftCard(overrides: Partial<AgentDraftCardState> = {}): AgentDraftCardState {
  return { draft: NORA, draftedBy: "coco", afterUserTurn: 1, ...overrides };
}

function fakeAgentChat() {
  const agents: CustomAgent[] = [COCO];
  const store = {
    subscribe: () => () => {},
    getAgents: () => agents,
    folderNames: () => agents.map((agent) => agent.slug),
    createAgent: jest.fn(async () => {
      agents.push(NORA_AGENT);
      return NORA_AGENT.slug;
    }),
  } as unknown as CustomAgentStore;
  const manager = {};
  const plugin = {
    app: { vault: {} },
    agentSessionManager: manager,
  } as unknown as CopilotPlugin;
  return { plugin, store, manager };
}

function ComposerFocus({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  React.useEffect(() => registerFocusHandler(onFocus), [registerFocusHandler, onFocus]);
  return null;
}

function renderSlot(card: AgentDraftCardState, { plugin, store } = fakeAgentChat()) {
  const chat = fakeChat();
  const focusComposer = jest.fn();
  chat.updateChatState(AGENT_DRAFT_CARD, () => card);
  render(
    <CustomAgentStoreContext.Provider value={store}>
      <ChatInputProvider>
        <ComposerFocus onFocus={focusComposer} />
        {agentDraftCardSlot.render(card, "draft", { plugin, chat })}
      </ChatInputProvider>
    </CustomAgentStoreContext.Provider>
  );
  return { chat, focusComposer };
}

describe("AgentDraftCard", () => {
  const openedModals: FakeObsidianModal[] = [];

  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  beforeEach(async () => {
    resetSettings();
    await setCustomAgentsAccess("team");
    const open = obsidian.Modal.prototype.open;
    jest.spyOn(obsidian.Modal.prototype, "open").mockImplementation(function (
      this: FakeObsidianModal
    ) {
      openedModals.push(this);
      open.call(this);
    });
  });

  afterEach(() => {
    act(() => openedModals.splice(0).forEach((modal) => modal.onClose()));
    jest.restoreAllMocks();
    jest.mocked(startCustomAgentChat).mockClear();
    document.body.innerHTML = "";
  });

  describe("AgentDraftCard()", () => {
    it(`shows the drafted name, title and instruction with Not now and Review and create…, and no Create (${ISSUE})`, () => {
      render(<AgentDraftCard draft={NORA} onDismiss={jest.fn()} onReview={jest.fn()} />);

      expect(screen.getByText("New teammate draft")).not.toBeNull();
      expect(screen.getByText("Nora")).not.toBeNull();
      expect(screen.getByText("Family calendar and school logistics")).not.toBeNull();
      expect(screen.getByText(NORA.instruction)).not.toBeNull();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Not now",
        "Review and create…",
      ]);
    });

    it(`cuts a long instruction to three lines with a way to show all of it (${ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
      jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);

      render(
        <AgentDraftCard
          draft={{ ...NORA, instruction: "Plan pickups. ".repeat(80) }}
          onDismiss={jest.fn()}
          onReview={jest.fn()}
        />
      );
      expect(screen.getByTestId("clamped-content").className).toContain("tw-max-h-[3lh]");
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));

      expect(screen.getByTestId("clamped-content").className).not.toContain("tw-max-h-[3lh]");
    });

    it("leaves out the title and instruction lines when the draft has none", () => {
      render(
        <AgentDraftCard
          draft={{ name: "Nora", title: "", instruction: "" }}
          onDismiss={jest.fn()}
          onReview={jest.fn()}
        />
      );

      expect(screen.queryByTestId("clamped-content")).toBeNull();
      expect(screen.getByTestId("agent-draft-card").textContent).toBe(
        "New teammate draftNoraNot nowReview and create…"
      );
    });
  });

  describe("agentDraftCardSlot", () => {
    describe("place()", () => {
      const transcript = [
        message("u1", USER_SENDER),
        message("a1", AI_SENDER),
        message("u2", USER_SENDER),
      ];

      it(`places the one draft after the user turn that asked for it, counted by turn so a Reload or reopened note keeps it there (${ISSUE})`, () => {
        expect(agentDraftCardSlot.place(draftCard({ afterUserTurn: 2 }), transcript)).toEqual([
          { id: "draft", afterUserMessageId: "u2" },
        ]);
      });

      it("places nothing once the draft is dismissed", () => {
        expect(agentDraftCardSlot.place(null, transcript)).toEqual([]);
      });
    });

    describe("render()", () => {
      it(`dismisses the card on Not now, leaving the chat with no card to bring back (${ISSUE})`, () => {
        const { chat } = renderSlot(draftCard());

        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });

      it(`opens the create dialog filled with the draft under "Drafted by" the agent that drafted it, and creates nothing until the user presses Create (${ISSUE})`, () => {
        const agentChat = fakeAgentChat();
        renderSlot(draftCard(), agentChat);

        fireEvent.click(screen.getByRole("button", { name: "Review and create…" }));

        expect(screen.getByText("Drafted by Coco.")).not.toBeNull();
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Nora");
        expect(screen.getByLabelText<HTMLInputElement>(/Title/).value).toBe(NORA.title);
        expect(screen.getByLabelText<HTMLTextAreaElement>("What Nora handles").value).toBe(
          NORA.instruction
        );
        expect(agentChat.store.createAgent).not.toHaveBeenCalled();
      });

      it(`after Create, opens the new agent's home with it selected and the cursor in its chat input, and removes the card from the drafting chat (${ISSUE})`, async () => {
        const agentChat = fakeAgentChat();
        const { chat, focusComposer } = renderSlot(draftCard(), agentChat);
        fireEvent.click(screen.getByRole("button", { name: "Review and create…" }));

        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => expect(focusComposer).toHaveBeenCalled());
        expect(startCustomAgentChat).toHaveBeenCalledWith(agentChat.manager, NORA_AGENT);
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });

      it(`keeps the card and its Review and create… button when the dialog closes without creating, so the draft can be opened again (${ISSUE})`, () => {
        const agentChat = fakeAgentChat();
        const { chat } = renderSlot(draftCard(), agentChat);
        fireEvent.click(screen.getByRole("button", { name: "Review and create…" }));

        act(() => void openedModals[0].pressEscape());

        expect(openedModals[0].isOpen).toBe(false);
        expect(agentChat.store.createAgent).not.toHaveBeenCalled();
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toEqual(draftCard());
        expect(screen.getByRole("button", { name: "Review and create…" })).not.toBeNull();
      });

      it.each([
        ["once the drafting agent is gone", "removed"],
        ["for a draft from a Copilot chat", null],
      ])(`opens the dialog without "Drafted by" %s (${ISSUE})`, (_case, draftedBy) => {
        renderSlot(draftCard({ draftedBy }));

        fireEvent.click(screen.getByRole("button", { name: "Review and create…" }));

        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Nora");
        expect(screen.queryByText(/Drafted by/)).toBeNull();
      });

      it.each(["free", "plus-without-custom-agents"] as const)(
        `draws nothing while custom agents aren't available (%s), so the chat reads as on master (${ISSUE})`,
        async (access) => {
          await setCustomAgentsAccess(access);

          renderSlot(draftCard());

          expect(screen.queryByTestId("agent-draft-card")).toBeNull();
        }
      );
    });
  });
});
