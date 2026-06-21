import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { render } from "@testing-library/react";
import React from "react";

// Entitlement gate — flipped per test.
const mockUseCanUseMultiAgent = jest.fn<boolean, []>();
const mockNavigateToPlusPage = jest.fn();
jest.mock("@/plusUtils", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useCanUseMultiAgent` hook; the name must match the export
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

// Capture the brands handed to the editor without rendering the heavy
// Lexical-backed composer.
let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: (props: { agentBrands?: ReadonlyArray<unknown> }) => {
    capturedAgentBrands = props.agentBrands;
    return null;
  },
}));

// Trim incidental module-level dependencies the composer pulls in.
jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useActiveWebTabState` hook; the name must match the export
  useActiveWebTabState: () => ({ activeWebTabForMentions: undefined }),
}));
jest.mock("@/aiParams", () => ({
  clearSelectedTextContexts: jest.fn(),
  removeSelectedTextContext: jest.fn(),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useSelectedTextContexts` hook; the name must match the export
  useSelectedTextContexts: () => [[], jest.fn()],
}));
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useSettingsValue` hook; the name must match the export
  useSettingsValue: () => ({}),
}));
jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: () => ({ recordUsage: jest.fn() }) },
}));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: () => [] }));

import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";

function renderComposer() {
  const draft = {
    input: "",
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
  };
  const app = { workspace: { getActiveFile: () => null } };
  const props = {
    backend: { sendMessage: jest.fn(), cancel: jest.fn() },
    sessionId: "s1",
    draft,
    app,
    mainAgentId: null,
    updateUserMessageHistory: jest.fn(),
    isStarting: false,
    hasPendingPlanPermission: false,
    modelPickerOverride: null,
    modePickerOverride: null,
    onCycleMode: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  render(<AgentChatInput {...props} />);
}

describe("AgentChatInput agent-mention gate", () => {
  beforeEach(() => {
    capturedAgentBrands = undefined;
    mockNavigateToPlusPage.mockClear();
  });

  it("passes the real installed-agent list when entitled", () => {
    mockUseCanUseMultiAgent.mockReturnValue(true);
    renderComposer();
    expect(capturedAgentBrands).toBe(FAKE_BRANDS);
  });

  it("passes the frozen empty list (not a fresh []) when not entitled", () => {
    mockUseCanUseMultiAgent.mockReturnValue(false);
    renderComposer();
    expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
  });
});
