import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LicenseRequiredIcon } from "./LicenseRequiredIcon";

describe("LicenseRequiredIcon", () => {
  describe("LicenseRequiredIcon()", () => {
    it("lets lock clicks reach the row's pricing action (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", () => {
      const onClick = jest.fn();
      const { container } = render(
        <div onClick={onClick}>
          <LicenseRequiredIcon />
        </div>
      );
      fireEvent.click(container.querySelector("svg")!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
    it("states the reason in text, since the tooltip only answers a hover", () => {
      render(<LicenseRequiredIcon />);

      expect(screen.getByText("Copilot license required")).toBeTruthy();
    });
  });
});
