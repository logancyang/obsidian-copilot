import { AddContextButton } from "@/components/chat-components/AddContextButton";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/i18n", () => ({
  t: (key: string) => (key === "agentChat.context.add" ? "添加上下文" : key),
}));

describe("AddContextButton", () => {
  describe("AddContextButton()", () => {
    it("localizes Agent Mode without changing Quick Chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/326", () => {
      const props = {
        currentActiveFile: null,
        isCopilotPlus: false,
        onSelect: jest.fn(),
      };
      const { rerender } = render(<AddContextButton {...props} />);
      expect(screen.getByRole("button", { name: "Add context" })).toBeTruthy();

      rerender(<AddContextButton {...props} isAgentMode />);
      expect(screen.getByRole("button", { name: "添加上下文" })).toBeTruthy();
    });
  });
});
