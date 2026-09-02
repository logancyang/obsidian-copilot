import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import { AGENT_PROMPT_SUGGESTIONS } from "@/agentMode/ui/agentPromptSuggestions";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

// Mock factory names must match the real `use*` exports, so the no-hook `use`
// prefix is expected on the mocked hooks below.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

// Entitlement gate — flipped per test.
const mockUseCanUseMultiAgent = jest.fn<boolean, []>();
const mockNavigateToPlusPage = jest.fn();
jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: () => mockUseCanUseMultiAgent(),
  navigateToPlusPage: (...args: unknown[]) => mockNavigateToPlusPage(...args),
}));

// Installed agents the gate either surfaces or suppresses.
const FAKE_BRANDS = Object.freeze([{ id: "claude", displayName: "Claude", Icon: () => null }]);
jest.mock("@/agentMode/ui/mentionedAgents", () => ({
  EMPTY_ANSWERERS: Object.freeze([]),
  isFanout: () => false,
  resolveAnswerers: () => [],
  useInstalledAgentBrands: () => FAKE_BRANDS,
}));

// One ChatInput mock serves both suites: it captures the brands handed to the
// editor (agent-mention gate) AND renders a clickable send button that routes
// through `handleSendMessage` — the same entry the real Lexical editor's Enter
// key hits (send-flow regression tests).
let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
let capturedTopRightAccessory: React.ReactNode | undefined;
let capturedPlaceholderPrompts: ReadonlyArray<string> | undefined;
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: (props: {
    agentBrands?: ReadonlyArray<unknown>;
    topRightAccessory?: React.ReactNode;
    placeholderPrompts?: ReadonlyArray<string>;
    handleSendMessage?: () => void;
  }) => {
    capturedAgentBrands = props.agentBrands;
    capturedTopRightAccessory = props.topRightAccessory;
    capturedPlaceholderPrompts = props.placeholderPrompts;
    return (
      <>
        {props.topRightAccessory}
        <button type="button" onClick={() => props.handleSendMessage?.()}>
          send
        </button>
      </>
    );
  },
}));

jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: undefined }),
}));
jest.mock("@/aiParams", () => ({
  clearSelectedTextContexts: jest.fn(),
  removeSelectedTextContext: jest.fn(),
  useSelectedTextContexts: () => [[], jest.fn()],
}));
jest.mock("@/settings/model", () => ({
  getModelKeyFromModel: (model: { name: string; provider: string; _backendId?: string }) => {
    const baseKey = `${model.name}|${model.provider}`;
    return model._backendId ? `${model._backendId}:${baseKey}` : baseKey;
  },
  useSettingsValue: () => ({}),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: () => ({ recordUsage: jest.fn() }) },
}));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: () => [] }));
jest.mock("@/agentMode/session/expandCustomCommandPrefix", () => ({
  expandCustomCommandPrefix: async (text: string) => ({ text }),
}));
jest.mock("@/services/webViewerService/activeWebTabSnapshot", () => ({
  buildWebTabsWithActiveSnapshot: () => [],
}));

const makeApp = (): App => ({ workspace: { getActiveFile: () => null } }) as unknown as App;

const makeDraft = (overrides: Partial<AgentInputDraftControls> = {}): AgentInputDraftControls => ({
  input: "hello",
  images: [],
  contextNotes: [],
  includeActiveNote: false,
  includeActiveWebTab: false,
  loading: false,
  queue: [],
  setInput: jest.fn(),
  setContextNotes: jest.fn(),
  setSelectedImages: jest.fn(),
  addImages: jest.fn(),
  setIncludeActiveNote: jest.fn(),
  setIncludeActiveWebTab: jest.fn(),
  setLoading: jest.fn(),
  setQueue: jest.fn(),
  resetCompose: jest.fn(),
  ...overrides,
});

function inputNode(
  backend: AgentChatBackend,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}
) {
  return (
    <AgentChatInput
      backend={backend}
      plugin={{} as never}
      chatInputId="input-1"
      draft={draft}
      app={makeApp()}
      mainAgentId={null}
      updateUserMessageHistory={jest.fn()}
      isStarting={false}
      hasPendingPlanPermission={false}
      modelPickerOverride={undefined}
      modePickerOverride={undefined}
      onCycleMode={jest.fn()}
      {...extraProps}
    />
  );
}

const renderInput = (
  backend: AgentChatBackend,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}
) => render(inputNode(backend, draft, extraProps));

describe("AgentChatInput", () => {
  describe("identity and agent-mention gate", () => {
    beforeEach(() => {
      capturedAgentBrands = undefined;
      mockNavigateToPlusPage.mockClear();
    });

    it("passes the real installed-agent list when entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderInput(
        { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend,
        makeDraft()
      );
      expect(capturedAgentBrands).toBe(FAKE_BRANDS);
    });

    it("clears input-scoped context only when the logical chat input changes", () => {
      const clearSelectedTextContexts = jest.requireMock("@/aiParams")
        .clearSelectedTextContexts as jest.Mock;
      clearSelectedTextContexts.mockClear();
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;
      const draft = makeDraft();
      const view = renderInput(backend, draft);

      view.rerender(inputNode(backend, draft, { chatInputId: "input-1" }));
      expect(clearSelectedTextContexts).not.toHaveBeenCalled();
      view.rerender(inputNode(backend, draft, { chatInputId: "input-2" }));
      expect(clearSelectedTextContexts).toHaveBeenCalledTimes(1);
    });

    it("passes the frozen empty list (not a fresh []) when not entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderInput(
        { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend,
        makeDraft()
      );
      expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
    });
  });

  describe("sample-prompt placeholder", () => {
    const backend = () =>
      ({ sendMessage: jest.fn(), cancel: jest.fn() }) as unknown as AgentChatBackend;

    beforeEach(() => {
      capturedPlaceholderPrompts = undefined;
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("offers the sample prompts on an untouched landing", () => {
      renderInput(backend(), makeDraft({ input: "" }), { isLanding: true });
      expect(capturedPlaceholderPrompts).toBe(AGENT_PROMPT_SUGGESTIONS);
    });

    it("withholds them in a conversation, where the composer is no longer a landing", () => {
      renderInput(backend(), makeDraft({ input: "" }), { isLanding: false });
      expect(capturedPlaceholderPrompts).toBeUndefined();
    });

    it("offers them again once a draft is cleared, including a suggestion the user took", () => {
      const chat = backend();
      const view = renderInput(chat, makeDraft({ input: "" }), { isLanding: true });

      // Accepting a suggestion (or typing) fills the composer — Lexical hides the
      // placeholder while it holds text.
      view.rerender(
        inputNode(chat, makeDraft({ input: "Summarize my week" }), { isLanding: true })
      );
      view.rerender(inputNode(chat, makeDraft({ input: "" }), { isLanding: true }));
      expect(capturedPlaceholderPrompts).toBe(AGENT_PROMPT_SUGGESTIONS);
    });
  });

  describe("turn-completion loading reset", () => {
    it("regression: clears draft.loading when the turn resolves after the composer unmounted", async () => {
      // First send from a landing: the user message lands, AgentHome flips
      // landing→conversation, and the composer remounts mid-turn. The unmounting
      // instance's runSend must still clear the shared draft's loading flag,
      // or the Thinking spinner / stop button stick forever (#stuck-thinking).
      let resolveTurn!: () => void;
      const turn = new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
      const backend = {
        sendMessage: jest.fn(() => ({ turn })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft();

      const { unmount } = renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(true));
      expect(backend.sendMessage).toHaveBeenCalledTimes(1);

      // The landing→conversation flip unmounts this composer instance while the
      // turn is still in flight.
      unmount();

      await act(async () => {
        resolveTurn();
        await turn;
      });

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(false));
    });
  });

  describe("queue reason", () => {
    const makeBackend = () =>
      ({
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      }) as unknown as AgentChatBackend;

    /** Apply the functional updater handed to setQueue and return the enqueued item. */
    const enqueuedItem = (setQueue: jest.Mock) => {
      const updater = setQueue.mock.calls[0][0] as (
        q: readonly unknown[]
      ) => { queueReason?: string }[];
      return updater([])[0];
    };

    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("snapshots 'context' when the send is held for project-context materialization", async () => {
      const backend = makeBackend();
      const draft = makeDraft();

      renderInput(backend, draft, { activeProjectId: "proj-1", contextLoadBlocking: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("context");
    });

    it("snapshots 'busy' when queued behind an in-flight turn", async () => {
      const backend = makeBackend();
      const draft = makeDraft({ loading: true });

      renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("labels only context-held rows with the amber waiting prefix", () => {
      const draft = makeDraft({
        queue: [
          {
            id: "q1",
            text: "held for context",
            rawInput: "held for context",
            queueReason: "context",
          },
          { id: "q2", text: "held while busy", rawInput: "held while busy", queueReason: "busy" },
        ],
      });

      renderInput(makeBackend(), draft);

      const rows = screen.getAllByTitle(/held/);
      expect(rows[0].textContent).toContain("Waiting for context · held for context");
      expect(rows[1].textContent).toContain("held while busy");
      expect(rows[1].textContent).not.toContain("Waiting for context");
    });

    it("keeps queued images when the active model is known not to support vision", async () => {
      const backend = makeBackend();
      const draft = makeDraft({
        queue: [
          {
            id: "q1",
            text: "describe this",
            rawInput: "describe this",
            promptContent: [{ type: "image", mimeType: "image/png", data: "AA==" }],
          },
        ],
      });

      renderInput(backend, draft, {
        modelPickerOverride: {
          models: [
            {
              name: "text-only",
              provider: "agent",
              enabled: true,
              capabilities: [],
            },
          ],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => {});

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.setQueue).not.toHaveBeenCalled();
    });
  });

  describe("status-icon boundary", () => {
    // Locks the #205 layering decision: AgentChatInput owns the project-context
    // status node and hands it to the shared ChatInput only through the neutral
    // topRightAccessory slot — the shared component never learns what it is.
    beforeEach(() => {
      capturedTopRightAccessory = undefined;
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("passes the indicator through the accessory slot when mounted", () => {
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;

      renderInput(backend, makeDraft(), { contextStatusIndicator: <span>status</span> });
      expect(capturedTopRightAccessory).toBeTruthy();
      expect(screen.getByText("status")).toBeTruthy();
    });

    it("passes no accessory when there is no indicator (global scope)", () => {
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;

      renderInput(backend, makeDraft());
      expect(capturedTopRightAccessory).toBeUndefined();
    });
  });

  describe("compose reset ordering", () => {
    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("regression: clears the composer before awaiting attached-image conversion (#211)", async () => {
      // Hold the image read open so ordering is observable. The composer must
      // clear the instant the user sends, not after every File.arrayBuffer()
      // resolves — leaving the draft populated across those awaits let the
      // Lexical editor race resetCompose and strand the just-sent text in the
      // input when text was sent alongside images.
      let resolveRead!: (buf: ArrayBuffer) => void;
      const image = {
        type: "image/png",
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveRead = resolve;
          }),
      } as unknown as File;

      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft({ images: [image] });

      renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));

      // Composer is cleared while the image read is still pending, before the
      // turn is dispatched.
      await waitFor(() => expect(draft.resetCompose).toHaveBeenCalledTimes(1));
      expect(backend.sendMessage).not.toHaveBeenCalled();

      // Finishing the read lets the turn fire with the converted image attached.
      await act(async () => {
        resolveRead(new ArrayBuffer(1));
        await Promise.resolve();
      });
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      const promptContent = (backend.sendMessage as jest.Mock).mock.calls[0][2];
      expect(promptContent).toHaveLength(1);
      expect(promptContent[0].type).toBe("image");
    });
  });

  describe("hard-disable", () => {
    it("drops a send when the composer is disabled (orphaned project)", async () => {
      // The mocked ChatInput's send button routes through handleSendMessage — the
      // same entry the real Lexical editor's Enter key hits. A hard-disabled
      // composer only dims + blocks pointer events in the DOM, so this keyboard
      // path must be gated in the handler or a turn leaks into a dead project.
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft();

      renderInput(backend, draft, { disabled: true });
      fireEvent.click(screen.getByText("send"));
      await act(async () => {});

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.setLoading).not.toHaveBeenCalledWith(true);
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });
  });
});
