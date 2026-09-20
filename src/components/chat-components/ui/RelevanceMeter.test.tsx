import {
  RelevanceMeter,
  meterColor,
  meterWidth,
} from "@/components/chat-components/ui/RelevanceMeter";
import { render } from "@testing-library/react";
import React from "react";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/516";

describe("RelevanceMeter", () => {
  describe("RelevanceMeter()", () => {
    it(`shares the clamped score width, accent grading, and motion preference (${issue})`, () => {
      const { container, rerender } = render(<RelevanceMeter score={0.72} animated />);
      const fill = container.querySelector<HTMLElement>(".copilot-relevance-meter-fill");

      expect(meterWidth(-1)).toBe("0%");
      expect(meterWidth(0.72)).toBe("72%");
      expect(meterWidth(2)).toBe("100%");
      expect(meterColor(0.72)).toContain("96%");
      expect(fill?.style.getPropertyValue("--relevance-meter-fill")).toBe("72%");
      expect(fill?.className).toContain("tw-transition-[width,background-color]");

      rerender(<RelevanceMeter score={0.72} animated={false} />);
      expect(
        container.querySelector<HTMLElement>(".copilot-relevance-meter-fill")?.className
      ).not.toContain("tw-transition-[width,background-color]");
    });
  });
});
