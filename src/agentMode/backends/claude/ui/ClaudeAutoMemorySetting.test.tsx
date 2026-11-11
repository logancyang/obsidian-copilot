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
      folderSetInClaude: false,
    },
    onOpenFolder: jest.fn(),
    onClear: jest.fn(),
    ...overrides,
  };
  render(<ClaudeAutoMemorySetting {...props} />);
  return props;
}

describe("ClaudeAutoMemorySetting", () => {
  describe("ClaudeAutoMemorySetting()", () => {
    it(`shows each memory folder with Open, and Clear memory, while memory is on (${ISSUE})`, () => {
      const props = renderSetting();

      expect(screen.getByText(VAULT_MEMORY)).toBeTruthy();
      expect(screen.getByText(PROJECT_MEMORY)).toBeTruthy();
      fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]);
      fireEvent.click(screen.getByRole("button", { name: "Clear memory" }));

      expect(props.onOpenFolder).toHaveBeenCalledWith(PROJECT_MEMORY);
      expect(props.onClear).toHaveBeenCalledTimes(1);
    });

    it.each([
      [true, "Default (On)"],
      [false, "Default (Off)"],
    ])(
      `names Claude Code's own value %s in the default option (${ISSUE})`,
      (onByDefault, label) => {
        renderSetting({ memory: { onByDefault, folders: [], folderSetInClaude: false } });

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
      ["the Claude Code default while Claude Code has it off", undefined, false],
    ])(`hides the memory files when memory is %s (${ISSUE})`, (_when, value, onByDefault) => {
      renderSetting({
        value,
        memory: { onByDefault, folders: [VAULT_MEMORY], folderSetInClaude: false },
      });

      expect(screen.queryByText("Memory files")).toBeNull();
    });

    it(`shows the memory files when On overrides Claude Code's off default (${ISSUE})`, () => {
      renderSetting({
        value: true,
        memory: { onByDefault: false, folders: [VAULT_MEMORY], folderSetInClaude: false },
      });

      expect(screen.getByText(VAULT_MEMORY)).toBeTruthy();
    });

    it(`says nothing is saved yet and offers no Clear when Claude has written no memory (${ISSUE})`, () => {
      renderSetting({
        memory: { onByDefault: true, folders: [], folderSetInClaude: false },
      });

      expect(screen.getByText("Nothing saved yet")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Clear memory" })).toBeNull();
    });

    it(`offers Open but no Clear for a folder Claude Code's settings choose, which may hold other projects' memory or anything else (${ISSUE})`, () => {
      renderSetting({
        memory: {
          onByDefault: true,
          folders: ["/home/claude-memory"],
          folderSetInClaude: true,
        },
      });

      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
      expect(screen.getByText("Folder set in Claude Code")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Clear memory" })).toBeNull();
    });
  });
});
