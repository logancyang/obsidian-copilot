import { render, screen } from "@testing-library/react";
import React from "react";
import { LicenseRequiredIcon } from "./LicenseRequiredIcon";

describe("LicenseRequiredIcon", () => {
  describe("LicenseRequiredIcon()", () => {
    it("stays hoverable on a row that has turned pointer events off", () => {
      const { container } = render(<LicenseRequiredIcon />);

      // The lock only ever sits on a disabled row, and a disabled
      // `DropdownMenuItem` sets `pointer-events: none`, which descendants
      // inherit. Without the reset the tooltip cannot open and the greyed row
      // has nothing left to say why it is locked.
      expect(container.firstElementChild?.className).toContain("tw-pointer-events-auto");
    });

    it("states the reason in text, since the tooltip only answers a hover", () => {
      render(<LicenseRequiredIcon />);

      // The tooltip content renders on hover, and a disabled row can take
      // neither hover nor focus from a keyboard, so this hidden copy is the
      // reason's only route into the row's accessible name.
      expect(screen.getByText("Copilot license required")).toBeTruthy();
    });

    it("keeps a caller's classes alongside its own", () => {
      const { container } = render(<LicenseRequiredIcon className="tw-mt-0.5" />);

      expect(container.firstElementChild?.className).toContain("tw-mt-0.5");
      expect(container.firstElementChild?.className).toContain("tw-pointer-events-auto");
    });
  });
});
