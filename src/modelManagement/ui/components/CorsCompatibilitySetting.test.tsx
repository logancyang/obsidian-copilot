import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { CORS_COMPATIBILITY_TOOLTIP, CorsCompatibilitySetting } from "./CorsCompatibilitySetting";

describe("CorsCompatibilitySetting", () => {
  describe("CorsCompatibilitySetting()", () => {
    it("explains the Quick Chat streaming tradeoff in a fixed-width tooltip (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      render(<CorsCompatibilitySetting checked={false} onCheckedChange={jest.fn()} />);

      fireEvent.pointerMove(
        screen.getByRole("button", { name: "About Quick Chat CORS compatibility" })
      );

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toBe(CORS_COMPATIBILITY_TOOLTIP);
      expect(tooltip.parentElement?.className).toContain("tw-w-72");
    });

    it("reports the user's transport choice", () => {
      const onCheckedChange = jest.fn();
      render(<CorsCompatibilitySetting checked={false} onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("switch", { name: "Enable CORS" }));

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });
});
