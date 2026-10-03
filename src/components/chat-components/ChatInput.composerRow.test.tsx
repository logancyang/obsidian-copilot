import { BUILTIN_AGENT_SLUG } from "@/agents/types";
import ChatInput, { type ChatInputProps } from "@/components/chat-components/ChatInput";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/aiParams", () => ({
  useChainType: jest.fn().mockReturnValue(["agent"]),
  useModelKey: jest.fn().mockReturnValue(["model", jest.fn()]),
}));
jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({ activeModels: [] }),
}));
jest.mock("@/components/chat-components/ContextControl", () => ({ ContextControl: () => null }));
jest.mock("@/components/chat-components/LexicalEditor", () => ({
  __esModule: true,
  default: () => <input aria-label="Message" />,
}));

const effortOptions = [
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

const COPILOT_AGENT = {
  slug: BUILTIN_AGENT_SLUG,
  name: "Copilot",
  avatarSrc: null,
  showLabel: false,
};

const JENNIFER_AGENT = {
  slug: "jennifer",
  name: "Jennifer",
  avatarSrc: null,
  showLabel: true,
};

function composer(): ChatInputProps {
  return {
    inputMessage: "",
    selectedImages: [],
    handleSendMessage: jest.fn(),
    isGenerating: false,
    isAgentMode: true,
    app: { workspace: { getActiveFile: () => null, on: jest.fn(), offref: jest.fn() } },
    contextNotes: [],
    setContextNotes: jest.fn(),
    setInputMessage: jest.fn(),
    onStopGenerating: jest.fn(),
    setIncludeActiveNote: jest.fn(),
    setIncludeActiveWebTab: jest.fn(),
    onAddImage: jest.fn(),
    setSelectedImages: jest.fn(),
    includeActiveNote: false,
    includeActiveWebTab: false,
    activeWebTab: null,
    modelPickerOverride: {
      models: [{ name: "sonnet", displayName: "Sonnet", provider: "agent", enabled: true }],
      value: "sonnet|agent",
      onChange: jest.fn(),
      effort: { options: effortOptions, value: "low", onChange: jest.fn() },
      effortOptionsByModelKey: { "sonnet|agent": effortOptions },
      commitSelection: jest.fn(),
    },
    agent: COPILOT_AGENT,
  } as unknown as ChatInputProps;
}

describe("ChatInput", () => {
  describe("ChatInput()", () => {
    it("offers no agent control on a new chat, where the agent is chosen on the landing above (designdocs/CUSTOM_AGENTS.md §3)", () => {
      render(<ChatInput {...composer()} />);

      expect(screen.queryByLabelText(/This chat is with/)).toBeNull();
      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });

    it("names a started chat's agent beside Add Context as a label, not a button", () => {
      render(<ChatInput {...composer()} agent={JENNIFER_AGENT} />);

      const addContext = screen.getByLabelText("Add context");
      const label = screen.getByLabelText(/This chat is with Jennifer/);

      expect(label.textContent).toBe("JJennifer");
      expect(label.closest("button")).toBeNull();
      expect(label.parentElement).toBe(addContext.parentElement);
    });

    it("keeps the model picker while a custom agent answers, so a chat can switch models without changing the agent's own (designdocs/CUSTOM_AGENTS.md §3)", () => {
      render(<ChatInput {...composer()} agent={JENNIFER_AGENT} />);

      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });

    it("keeps the model picker for Copilot, which pins nothing, even once its chat has started", () => {
      render(<ChatInput {...composer()} agent={{ ...COPILOT_AGENT, showLabel: true }} />);

      expect(screen.getByLabelText(/This chat is with Copilot/)).toBeTruthy();
      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });

    it("renders no agent label and keeps the model picker when the caller names no agent, as Quick Chat does", () => {
      render(<ChatInput {...composer()} agent={undefined} />);

      expect(screen.queryByLabelText(/This chat is with/)).toBeNull();
      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });
  });
});
