import { LegacyChatPromptsNotice } from "./LegacyChatPromptsNotice";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const app = { setting: { close: jest.fn() } };
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useApp: () => app,
}));
jest.mock("@/system-prompts/state", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useSystemPrompts: () => [{ title: "Editing" }, { title: "Research" }],
}));
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveSystemPromptsFolder: () => "Workspace/Prompts",
}));
jest.mock("@/utils/revealFolderInExplorer", () => ({ revealFolderInExplorer: jest.fn() }));

describe("LegacyChatPromptsNotice", () => {
  describe("LegacyChatPromptsNotice()", () => {
    it("opens the saved folder after dismissing settings, preserving manual copying (https://github.com/Brevilabs/obsidian-copilot-private/issues/419)", () => {
      render(
        <TabProvider>
          <LegacyChatPromptsNotice />
        </TabProvider>
      );
      expect(screen.getByText("Your saved prompts are still available")).not.toBeNull();
      expect(screen.getByText(/Copy the instructions you want/)).not.toBeNull();
      expect(screen.getByText(/Existing prompt files stay unchanged/)).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open saved prompts" }));
      expect(revealFolderInExplorer).toHaveBeenCalledWith(app, "Workspace/Prompts");
      expect(app.setting.close.mock.invocationCallOrder[0]).toBeLessThan(
        (revealFolderInExplorer as jest.Mock).mock.invocationCallOrder[0]
      );
    });
    it("navigates from Advanced to the actual instructions section without opening or applying a prompt (https://github.com/Brevilabs/obsidian-copilot-private/issues/419)", () => {
      let frame!: FrameRequestCallback;
      const requestFrame = jest
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          frame = callback;
          return 1;
        });
      const scroll = jest.fn();
      const Host = () => {
        const { selectedTab } = useTab();
        return selectedTab === "advanced" ? (
          <LegacyChatPromptsNotice />
        ) : (
          <span
            id="copilot-vault-instructions"
            tabIndex={-1}
            ref={(node) => {
              if (node) node.scrollIntoView = scroll;
            }}
          >
            Custom instructions
          </span>
        );
      };
      render(
        <TabProvider initialTab="advanced">
          <Host />
        </TabProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Open vault instructions" }));
      frame(0);
      expect(document.activeElement).toBe(screen.getByText("Custom instructions"));
      expect(scroll).toHaveBeenCalled();
      requestFrame.mockRestore();
    });
  });
});
