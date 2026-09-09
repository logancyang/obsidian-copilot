import { fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import React from "react";
import { AgentIconButton } from "./AgentIconButton";

describe("AgentIconButton", () => {
  describe("AgentIconButton()", () => {
    it("supports pointer and keyboard activation", () => {
      const onClick = jest.fn();
      render(<AgentIconButton Icon={Bot} agentId="claude" enabled onClick={onClick} />);
      const button = screen.getByRole("button");
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: "Enter" });
      fireEvent.keyDown(button, { key: " " });
      expect(onClick).toHaveBeenCalledTimes(3);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    });
    it("keeps unavailable agent controls inert for https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const onClick = jest.fn();
      render(
        <AgentIconButton Icon={Bot} agentId="opencode" enabled={false} disabled onClick={onClick} />
      );
      const button = screen.getByRole("button");
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: "Enter" });
      expect(onClick).not.toHaveBeenCalled();
      expect(button.tabIndex).toBe(-1);
      expect(button.getAttribute("aria-disabled")).toBe("true");
    });
  });
});
