import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntelligentUiSetting } from "./IntelligentUiSetting";

describe("IntelligentUiSetting", () => {
  describe("IntelligentUiSetting()", () => {
    it("shows the generation preference and forwards toggle changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/884)", () => {
      const onCheckedChange = jest.fn();
      const { rerender } = render(
        <IntelligentUiSetting checked={false} onCheckedChange={onCheckedChange} />
      );
      expect(
        screen.getByText("Show richer visual layouts in AI answers. Saved notes remain Markdown.")
      ).toBeTruthy();
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      fireEvent.click(screen.getByRole("switch"));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
      rerender(<IntelligentUiSetting checked={true} onCheckedChange={onCheckedChange} />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    });
  });
});
