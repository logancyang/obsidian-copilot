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
    enabled: true,
    onEnabledChange: jest.fn(),
    memory: {
      turnedOffInClaude: false,
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

    it("reports the switch turned off", () => {
      const props = renderSetting();

      fireEvent.click(screen.getByRole("switch"));

      expect(props.onEnabledChange).toHaveBeenCalledWith(false);
    });

    it(`hides the memory files while the switch is off (${ISSUE})`, () => {
      renderSetting({ enabled: false });

      expect(screen.queryByText("Memory files")).toBeNull();
    });

    it(`says nothing is saved yet and offers no Clear when Claude has written no memory (${ISSUE})`, () => {
      renderSetting({
        memory: { turnedOffInClaude: false, folders: [], folderSetInClaude: false },
      });

      expect(screen.getByText("Claude hasn't saved any memory for this vault yet.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Clear memory" })).toBeNull();
    });

    it(`offers Open but no Clear for a folder Claude Code's settings choose, which may hold other projects' memory or anything else (${ISSUE})`, () => {
      renderSetting({
        memory: {
          turnedOffInClaude: false,
          folders: ["/home/claude-memory"],
          folderSetInClaude: true,
        },
      });

      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Clear memory" })).toBeNull();
    });

    it(`says Claude Code's own settings turn memory off instead of showing it as on (${ISSUE})`, () => {
      renderSetting({
        memory: {
          turnedOffInClaude: true,
          folders: [VAULT_MEMORY],
          folderSetInClaude: false,
        },
      });

      expect(screen.getByText(/Your Claude Code settings turn auto memory off/)).toBeTruthy();
      expect(screen.queryByText("Memory files")).toBeNull();
    });
  });
});
