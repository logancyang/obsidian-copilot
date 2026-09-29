import { DesktopPicker } from "@/agentMode/mobile/ui/DesktopPicker";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const DESKTOPS = [
  { id: "a", desktopName: "Studio Mac", vaultName: "Work notes", address: "100.64.0.7:52341" },
  { id: "b", desktopName: "Laptop", vaultName: "Work notes", address: "100.64.0.9:50001" },
];

describe("DesktopPicker", () => {
  describe("DesktopPicker()", () => {
    it("lists every paired desktop and reports the one the user taps", () => {
      const onSelect = jest.fn();
      render(<DesktopPicker desktops={DESKTOPS} onSelect={onSelect} />);

      fireEvent.click(screen.getByRole("button", { name: /Laptop/ }));

      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(onSelect).toHaveBeenCalledWith("b");
    });

    it("points the user to the Remote settings when no desktop is paired", () => {
      render(<DesktopPicker desktops={[]} onSelect={() => {}} />);

      expect(screen.getByText("No desktop paired")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
