import { RevokeButton } from "@/agentMode/ui/RevokeButton";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("RevokeButton", () => {
  describe("RevokeButton()", () => {
    it("runs the revoke when chosen while nothing blocks it", () => {
      const onRevoke = jest.fn();
      render(<RevokeButton label="Revoke" blocked={null} tooltipSide="left" onRevoke={onRevoke} />);

      const button = screen.getByRole("button", { name: "Revoke" });
      fireEvent.click(button);

      expect(button.getAttribute("aria-disabled")).toBeNull();
      expect(onRevoke).toHaveBeenCalledTimes(1);
    });

    it("stays disabled and shows why on focus when the revoke is blocked", async () => {
      const onRevoke = jest.fn();
      render(
        <RevokeButton
          label="Revoke all"
          blocked="This note changed after the turn."
          tooltipSide="bottom"
          onRevoke={onRevoke}
        />
      );

      const button = screen.getByRole("button", { name: "Revoke all" });
      fireEvent.click(button);
      fireEvent.focus(button);

      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(onRevoke).not.toHaveBeenCalled();
      expect(
        (await screen.findAllByText("This note changed after the turn.")).length
      ).toBeGreaterThan(0);
    });
  });
});
