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
  } as unknown as ChatInputProps;
}

describe("ChatInput", () => {
  describe("ChatInput()", () => {
    it("names no agent in the composer, which carries only context and model controls", () => {
      render(<ChatInput {...composer()} />);

      expect(screen.queryByLabelText(/This chat is with/)).toBeNull();
      expect(screen.getByLabelText("Add context")).toBeTruthy();
      expect(screen.getByTitle("Model · effort")).toBeTruthy();
    });
  });
});
