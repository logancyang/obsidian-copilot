import { RemoteHeader } from "@/agentMode/mobile/ui/RemoteHeader";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("RemoteHeader", () => {
  describe("RemoteHeader()", () => {
    it("names the desktop and marks the link connected while it is live", () => {
      render(<RemoteHeader desktopName="Studio Mac" live={true} />);

      expect(screen.getByText("Studio Mac")).not.toBeNull();
      expect(screen.getByRole("img", { name: "Connected" })).not.toBeNull();
    });

    it("marks the link not connected while it is not live", () => {
      render(<RemoteHeader desktopName="Studio Mac" live={false} />);

      expect(screen.getByRole("img", { name: "Not connected" })).not.toBeNull();
    });

    it("offers to choose another desktop only when the phone is given a way to", () => {
      const onSwitchDesktop = jest.fn();
      const { rerender } = render(<RemoteHeader desktopName="Studio Mac" live={true} />);
      expect(screen.queryByRole("button", { name: "Choose another desktop" })).toBeNull();

      rerender(
        <RemoteHeader desktopName="Studio Mac" live={true} onSwitchDesktop={onSwitchDesktop} />
      );
      fireEvent.click(screen.getByRole("button", { name: "Choose another desktop" }));

      expect(onSwitchDesktop).toHaveBeenCalledTimes(1);
    });
  });
});
