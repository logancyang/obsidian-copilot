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

const agentRows = [
  {
    slug: BUILTIN_AGENT_SLUG,
    name: "Copilot",
    icon: "✦",
    description: "Your vault instructions, no persona, no memory.",
    modelKey: null,
    effort: null,
  },
  {
    slug: "jennifer",
    name: "Jennifer",
    icon: "🪶",
    description: "Skeptical editor.",
    modelKey: "sonnet|agent",
    effort: "high",
  },
];

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
    agentPicker: {
      rows: agentRows,
      selectedSlug: BUILTIN_AGENT_SLUG,
      onSelect: jest.fn(),
    },
  } as unknown as ChatInputProps;
}

describe("ChatInput", () => {
  describe("ChatInput()", () => {
    it("stands the agent picker between the Add Context button and the model picker (designdocs/CUSTOM_AGENTS.md §3)", () => {
      render(<ChatInput {...composer()} />);

      const addContext = screen.getByLabelText("Add context");
      const agent = screen.getByTitle("Agent");
      const model = screen.getByTitle("Model · effort");

      expect(agent.textContent).toBe("✦Copilot");
      expect(
        addContext.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(agent.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // One row, so the three controls share a baseline and the row's own gap.
      expect(agent.parentElement).toBe(addContext.parentElement);
      expect(agent.parentElement).toBe(model.parentElement);
    });

    it("drops the model picker while a custom agent answers, whose model and effort come from its own config (designdocs/CUSTOM_AGENTS.md §3)", () => {
      const props = composer();
      render(
        <ChatInput {...props} agentPicker={{ ...props.agentPicker!, selectedSlug: "jennifer" }} />
      );

      const agent = screen.getByTitle("Agent");

      expect(agent.textContent).toBe("🪶Jennifer");
      expect(screen.queryByTitle("Model · effort")).toBeNull();
    });

    it("brings the model picker back when the chat returns to Copilot, which pins nothing", () => {
      const props = composer();
      const { rerender } = render(
        <ChatInput {...props} agentPicker={{ ...props.agentPicker!, selectedSlug: "jennifer" }} />
      );
      expect(screen.queryByTitle("Model · effort")).toBeNull();

      rerender(<ChatInput {...props} />);

      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });

    it("renders no agent picker when the caller supplies no roster, as Quick Chat does", () => {
      render(<ChatInput {...composer()} agentPicker={undefined} />);

      expect(screen.queryByTitle("Agent")).toBeNull();
      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });
  });
});
