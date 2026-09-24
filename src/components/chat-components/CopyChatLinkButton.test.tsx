import { CopyChatLinkButton } from "./CopyChatLinkButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("CopyChatLinkButton", () => {
  describe("CopyChatLinkButton()", () => {
    it("copies the current saved identity when clicked", () => {
      const onCopyLink = jest.fn();
      render(
        <TooltipProvider>
          <CopyChatLinkButton chatId="conversations/chat.md" onCopyLink={onCopyLink} />
        </TooltipProvider>
      );
      fireEvent.click(screen.getByTitle("Copy Chat Link"));
      expect(onCopyLink).toHaveBeenCalledWith("conversations/chat.md");
    });

    it("disables copying before the chat has a saved path or native session https://github.com/logancyang/obsidian-copilot/issues/3271", () => {
      const onCopyLink = jest.fn();
      render(
        <TooltipProvider>
          <CopyChatLinkButton onCopyLink={onCopyLink} />
        </TooltipProvider>
      );
      const button = screen.getByTitle("Copy Chat Link");
      expect(button).toHaveProperty("disabled", true);
      fireEvent.click(button);
      expect(onCopyLink).not.toHaveBeenCalled();
    });
  });
});
