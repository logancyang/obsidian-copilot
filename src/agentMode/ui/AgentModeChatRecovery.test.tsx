import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentModeChatRecovery } from "@/agentMode/ui/AgentModeChatRecovery";
import {
  Upgrade,
  ColdStartup,
  RecoveryStarting,
  StartupFailure,
} from "@/agentMode/ui/AgentModeChatRecovery.stories";

describe("AgentModeChatRecovery", () => {
  describe("AgentModeChatRecovery()", () => {
    it.each([Upgrade, StartupFailure])(
      "keeps model selection and Back available beside recovery status (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (story) => {
        const onCancel = jest.fn();
        render(<AgentModeChatRecovery {...story.args} onCancel={onCancel} />);
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Saved model/ })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
        expect(onCancel).toHaveBeenCalledTimes(1);
      }
    );
    it("offers saved models on cold startup with nothing selected and no source chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      render(<AgentModeChatRecovery {...ColdStartup.args} />);
      fireEvent.click(screen.getByRole("button", { name: "Select Model" }));
      expect(screen.getByRole("option", { name: /Saved model/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    });
    it("keeps the exit to the preserved chat while the chosen agent starts, with the picker locked (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      const onCancel = jest.fn();
      render(<AgentModeChatRecovery {...RecoveryStarting.args} onCancel={onCancel} />);
      expect(screen.getByRole("button", { name: /Saved model/ }).hasAttribute("disabled")).toBe(
        true
      );
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
