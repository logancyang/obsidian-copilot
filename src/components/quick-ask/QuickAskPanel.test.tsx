import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import { QuickAskPanel } from "@/components/quick-ask/QuickAskPanel";
import type { QuickAskPanelProps } from "@/components/quick-ask/types";
import { useQuickAskSession } from "@/components/quick-ask/useQuickAskSession";
import { updateSetting } from "@/settings/model";

let mockDefaultModel: string | undefined;
const mockSend = jest.fn(async () => undefined);
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => ({
    quickCommandModelKey: mockDefaultModel,
    quickCommandIncludeNoteContext: false,
  }),
  updateSetting: jest.fn(),
}));
jest.mock("@/aiParams", () => ({ useModelKey: () => ["legacy-chat"] }));
jest.mock("@/utils", () => ({ cleanMessageForCopy: (text: string) => text }));
jest.mock("@/hooks/use-draggable", () => ({
  useDraggable: () => ({ handleMouseDown: jest.fn() }),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (value: string) => void;
  }) => ({ value: value ?? "", onChange, models: [] }),
}));
jest.mock("@/components/ui/ModelSelector", () => ({
  ModelSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="Model" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select model</option>
      <option value="gemini">Gemini</option>
      <option value="gpt">GPT</option>
    </select>
  ),
}));
jest.mock("@/components/quick-ask/QuickAskInput", () => ({
  QuickAskInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Question" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock("@/components/quick-ask/QuickAskMessage", () => ({
  QuickAskMessageComponent: () => null,
}));
jest.mock("@/components/quick-ask/useQuickAskSession", () => ({ useQuickAskSession: jest.fn() }));
jest.mock("@/components/ui/help-tooltip", () => ({ HelpTooltip: () => null }));

const props = {
  plugin: { app: { workspace: { getActiveFile: () => null } } },
  view: {},
  editor: {},
  selectedText: "She go to school yesterday.",
  replaceGuard: { getRange: () => null },
  onClose: jest.fn(),
} as unknown as QuickAskPanelProps;

describe("QuickAskPanel", () => {
  describe("QuickAskPanel()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockDefaultModel = "gemini";
      jest.mocked(useQuickAskSession).mockImplementation(({ selectedModelKey }) => ({
        hasModel: !!selectedModelKey,
        messages: [],
        isStreaming: false,
        sendMessage: mockSend,
        stop: jest.fn(),
        clear: jest.fn(),
      }));
    });

    it("sends the question with the configured default and clears the submitted draft", async () => {
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Fix the sentence" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith("Fix the sentence"));
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("");
    });

    it("keeps a popup model choice local and reopens with the default — https://github.com/Brevilabs/obsidian-copilot-private/issues/616", () => {
      const { unmount } = render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt" } });
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gpt");
      expect(updateSetting).not.toHaveBeenCalled();
      unmount();
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini");
    });

    it("preserves the question without a model and sends it after an explicit choice — https://github.com/Brevilabs/obsidian-copilot-private/issues/616", async () => {
      mockDefaultModel = undefined;
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Fix the sentence" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      expect(mockSend).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Select a model to continue.");
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("Fix the sentence");
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt" } });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith("Fix the sentence"));
    });
  });
});
