import React from "react";
import { render, screen } from "@testing-library/react";
import { AgentModeChatRecovery } from "@/agentMode/ui/AgentModeChatRecovery";
import { Upgrade, StartupFailure } from "@/agentMode/ui/AgentModeChatRecovery.stories";

describe("AgentModeChatRecovery", () => {
  describe("AgentModeChatRecovery()", () => {
    it.each([Upgrade, StartupFailure])(
      "keeps model selection available beside the blocking status (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (story) => {
        render(<AgentModeChatRecovery {...story.args} />);
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Saved model/ })).toBeTruthy();
      }
    );
  });
});
