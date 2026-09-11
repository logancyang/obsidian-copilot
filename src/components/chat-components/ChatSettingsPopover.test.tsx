import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockSetDisableBuiltin = jest.fn();
let mockSessionPrompt = "";

jest.mock("@/context", () => ({
  useApp: jest.fn(() => ({ workspace: { openLinkText: jest.fn() } })),
}));
jest.mock("@/system-prompts", () => ({
  getDefaultSystemPromptTitle: () => "Legacy default",
  getDisableBuiltinSystemPrompt: () => false,
  getPromptFilePath: (title: string) => `copilot/system-prompts/${title}.md`,
  setDisableBuiltinSystemPrompt: (value: boolean) => {
    mockSetDisableBuiltin(value);
  },
  useSelectedPrompt: () => React.useState(mockSessionPrompt),
  useSystemPrompts: jest.fn(() => [{ title: "Legacy default" }, { title: "Writing coach" }]),
}));

function openSettings() {
  render(
    <TooltipProvider>
      <ChatSettingsPopover />
    </TooltipProvider>
  );
  fireEvent.click(screen.getByRole("button"));
  return screen.getByRole<HTMLSelectElement>("combobox");
}

describe("ChatSettingsPopover", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    mockSessionPrompt = "";
    mockSetDisableBuiltin.mockClear();
  });

  describe("ChatSettingsPopover()", () => {
    it("shows AGENTS.md as the default even with a legacy global prompt https://github.com/logancyang/obsidian-copilot/issues/3210", () => {
      const select = openSettings();
      expect(select.value).toBe("");
      expect(select.selectedOptions[0].text).toBe("Default (AGENTS.md)");
      expect(screen.getByTitle("Open the source file")).toHaveProperty("disabled", true);
      expect(screen.queryByText("Legacy default (Default)")).toBeNull();
    });

    it("shows an explicitly selected session prompt and allows returning to AGENTS.md", () => {
      mockSessionPrompt = "Writing coach";
      const select = openSettings();
      expect(select.value).toBe("Writing coach");
      expect(screen.getByTitle("Open the source file")).toHaveProperty("disabled", false);

      fireEvent.change(select, { target: { value: "" } });
      expect(select.selectedOptions[0].text).toBe("Default (AGENTS.md)");

      fireEvent.change(select, { target: { value: "Legacy default" } });
      expect(select.selectedOptions[0].text).toBe("Legacy default");
    });

    it("resets an explicit selection to AGENTS.md and restores builtin instructions", () => {
      mockSessionPrompt = "Writing coach";
      const select = openSettings();
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(select.selectedOptions[0].text).toBe("Default (AGENTS.md)");
      expect(mockSetDisableBuiltin).toHaveBeenCalledWith(false);
    });
  });
});
