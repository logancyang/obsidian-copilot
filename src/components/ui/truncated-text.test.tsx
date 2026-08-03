import { render, screen } from "@testing-library/react";
import React from "react";
import { TruncatedText } from "@/components/ui/truncated-text";

describe("truncated-text", () => {
  describe("TruncatedText()", () => {
    it("renders its content with single-line truncation by default", () => {
      render(<TruncatedText>Long label</TruncatedText>);

      const text = screen.getByTestId("truncatedText");
      expect(text.textContent).toBe("Long label");
      expect(text.classList.contains("tw-truncate")).toBe(true);
    });

    it("uses the configured multi-line clamp instead of single-line truncation", () => {
      render(<TruncatedText lineClamp={2}>Long label</TruncatedText>);

      const text = screen.getByTestId("truncatedText");
      expect(text.classList.contains("tw-line-clamp-2")).toBe(true);
      expect(text.classList.contains("tw-truncate")).toBe(false);
    });
  });
});
