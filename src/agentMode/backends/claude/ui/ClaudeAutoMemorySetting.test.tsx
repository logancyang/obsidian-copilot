import { fireEvent, render, screen } from "@testing-library/react";
import {
  ClaudeAutoMemorySetting,
  type ClaudeAutoMemorySettingProps,
} from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import React from "react";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/2892";
const VAULT_MEMORY = "/home/.claude/projects/-vault/memory";
const PROJECT_MEMORY = "/home/.claude/projects/-vault-Research/memory";

function renderSetting(overrides: Partial<ClaudeAutoMemorySettingProps> = {}) {
  const props: ClaudeAutoMemorySettingProps = {
    value: undefined,
    onChange: jest.fn(),
    memory: {
      onByDefault: true,
      folders: [VAULT_MEMORY, PROJECT_MEMORY],
    },
    onOpen: jest.fn(),
    ...overrides,
  };
  render(<ClaudeAutoMemorySetting {...props} />);
  return props;
}

describe("ClaudeAutoMemorySetting", () => {
  describe("ClaudeAutoMemorySetting()", () => {
    it(`offers one Open for the saved memory, without listing paths, while memory is on (${ISSUE})`, () => {
      const props = renderSetting();

      expect(screen.queryByText(VAULT_MEMORY)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(props.onOpen).toHaveBeenCalledTimes(1);
    });

    it.each([
      [true, "Default (On)"],
      [false, "Default (Off)"],
    ])(
      `names Claude Code's own value %s in the default option (${ISSUE})`,
      (onByDefault, label) => {
        renderSetting({ memory: { onByDefault, folders: [] } });

        expect(screen.getByRole("option", { name: label })).toBeTruthy();
      }
    );

    it.each([
      ["on", true],
      ["off", false],
      ["default", undefined],
    ])(`reports choosing %s as %p (${ISSUE})`, (choice, value) => {
      const props = renderSetting({ value: true });

      fireEvent.change(screen.getByRole("combobox"), { target: { value: choice } });

      expect(props.onChange).toHaveBeenCalledWith(value);
    });

    it.each([
      ["Off", false, true],
      ["Default while Claude Code has it off", undefined, false],
    ])(`hides the memory files when memory is %s (${ISSUE})`, (_when, value, onByDefault) => {
      renderSetting({
        value,
        memory: { onByDefault, folders: [VAULT_MEMORY] },
      });

      expect(screen.queryByText("Memory files")).toBeNull();
    });

    it(`shows the memory files when On overrides Claude Code's off default (${ISSUE})`, () => {
      renderSetting({
        value: true,
        memory: { onByDefault: false, folders: [VAULT_MEMORY] },
      });

      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    });

    it(`says nothing is saved yet and offers no Open when Claude has written no memory (${ISSUE})`, () => {
      renderSetting({
        memory: { onByDefault: true, folders: [] },
      });

      expect(screen.getByText("Nothing saved yet")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    });
  });
});
