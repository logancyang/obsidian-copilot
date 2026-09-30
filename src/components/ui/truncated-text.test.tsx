import { TruncatedText } from "@/components/ui/truncated-text";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("truncated-text", () => {
  describe("TruncatedText()", () => {
    it("renders its content", () => {
      render(<TruncatedText>Long label</TruncatedText>);

      expect(screen.getByTestId("truncatedText").textContent).toBe("Long label");
    });

    it("shows the tooltip on focus when alwaysShowTooltip is set", async () => {
      render(
        <TruncatedText alwaysShowTooltip tooltipContent="Full label">
          Long label
        </TruncatedText>
      );

      fireEvent.focus(screen.getByTestId("truncatedText"));

      expect(await screen.findByRole("tooltip")).toBeTruthy();
    });

    it("keeps the tooltip closed on focus when the text is not truncated", () => {
      render(<TruncatedText tooltipContent="Full label">Long label</TruncatedText>);

      fireEvent.focus(screen.getByTestId("truncatedText"));

      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });
});
