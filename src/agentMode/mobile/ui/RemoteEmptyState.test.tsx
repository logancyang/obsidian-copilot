import { RemoteEmptyState } from "@/agentMode/mobile/ui/RemoteEmptyState";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("RemoteEmptyState", () => {
  describe("RemoteEmptyState()", () => {
    it("starts a session when the button is pressed", () => {
      const onStart = jest.fn();
      render(<RemoteEmptyState desktopName="Studio Mac" creating={false} onStart={onStart} />);

      fireEvent.click(screen.getByRole("button", { name: "Start a session" }));

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it("disables the button while a session is being created", () => {
      render(<RemoteEmptyState desktopName="Studio Mac" creating onStart={() => {}} />);

      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Start a session" }).disabled
      ).toBe(true);
    });
  });
});
