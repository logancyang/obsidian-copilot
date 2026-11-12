import { fireEvent, render, screen } from "@testing-library/react";
import {
  ClaudeAutoMemorySetting,
  type ClaudeAutoMemorySettingProps,
} from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import React from "react";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/2892";
const MEMORY_FOLDER = "/home/.claude/projects/-vault/memory";

function renderSetting(overrides: Partial<ClaudeAutoMemorySettingProps> = {}) {
  const props: ClaudeAutoMemorySettingProps = {
    value: undefined,
    onChange: jest.fn(),
    memoryFolder: MEMORY_FOLDER,
    onOpen: jest.fn(),
    ...overrides,
  };
  render(<ClaudeAutoMemorySetting {...props} />);
  return props;
}

describe("ClaudeAutoMemorySetting", () => {
  describe("ClaudeAutoMemorySetting()", () => {
    it(`offers Default, On, and Off, with Default selected while no choice is saved (${ISSUE})`, () => {
      renderSetting();

      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Default",
        "On",
        "Off",
      ]);
      expect(screen.getByRole("combobox")).toHaveProperty("value", "default");
    });

    it.each([
      ["on", true],
      ["off", false],
      ["default", undefined],
    ])(`reports choosing %s as %p (${ISSUE})`, (choice, value) => {
      const props = renderSetting({ value: true });

      fireEvent.change(screen.getByRole("combobox"), { target: { value: choice } });

      expect(props.onChange).toHaveBeenCalledWith(value);
    });

    it(`opens the memory folder Claude reported when Open is clicked (${ISSUE})`, () => {
      const props = renderSetting();

      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(props.onOpen).toHaveBeenCalledWith(MEMORY_FOLDER);
    });

    it(`shows no Memory files row when Claude reported no memory folder (${ISSUE})`, () => {
      renderSetting({ memoryFolder: undefined });

      expect(screen.queryByText("Memory files")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    });
  });
});
