import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
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
  listInstalledAgentBrands: () => FAKE_BRANDS,
}));

// One ChatInput mock serves both suites: it captures the brands handed to the
// editor (agent-mention gate) AND renders a clickable send button that routes
// through `handleSendMessage` — the same entry the real Lexical editor's Enter
// key hits (send-flow regression tests).
let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: (props: { agentBrands?: ReadonlyArray<unknown>; handleSendMessage?: () => void }) => {
    capturedAgentBrands = props.agentBrands;
    return (
      <button type="button" onClick={() => props.handleSendMessage?.()}>
        send
      </button>
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
  migrateDraft: jest.fn(),
  resetCompose: jest.fn(),
  ...overrides,
});

function renderInput(
  backend: AgentChatBackend,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}
) {
  return render(
    <AgentChatInput
      backend={backend}
      sessionId="session-1"
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

describe("AgentChatInput agent-mention gate", () => {
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

  it("passes the frozen empty list (not a fresh []) when not entitled", () => {
    mockUseCanUseMultiAgent.mockReturnValue(false);
    renderInput(
      { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend,
      makeDraft()
    );
    expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
  });
});

describe("AgentChatInput turn-completion loading reset", () => {
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

describe("AgentChatInput hard-disable", () => {
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
