import { CopyChatLinkButton } from "./CopyChatLinkButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("CopyChatLinkButton", () => {
  describe("CopyChatLinkButton()", () => {
    it("runs the copy handler when clicked", () => {
      const onCopyLink = jest.fn();
      render(
        <TooltipProvider>
          <CopyChatLinkButton onCopyLink={onCopyLink} />
        </TooltipProvider>
      );
      fireEvent.click(screen.getByTitle("Copy Chat Link"));
      expect(onCopyLink).toHaveBeenCalledTimes(1);
    });

    it("is disabled when the chat has nothing to link to", () => {
      render(
        <TooltipProvider>
          <CopyChatLinkButton />
        </TooltipProvider>
      );
      expect(screen.getByTitle("Copy Chat Link")).toHaveProperty("disabled", true);
    });
  });
});
