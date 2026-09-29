import { RemoteConnectionScreen } from "@/agentMode/mobile/ui/RemoteConnectionScreen";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

describe("RemoteConnectionScreen", () => {
  describe("RemoteConnectionScreen()", () => {
    it(`asks whether Tailscale is on when the desktop never answered, with a way to retry (${ISSUE})`, () => {
      const onRetry = jest.fn();
      render(
        <RemoteConnectionScreen
          screen={{ kind: "unreachable" }}
          desktopName="Studio Mac"
          onRetry={onRetry}
        />
      );

      expect(screen.getByRole("alert").textContent).toContain(
        "Can't reach your desktop. Is Tailscale on?"
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("names the desktop that is offline and offers another desktop only when there is one", () => {
      const onSwitchDesktop = jest.fn();
      const { rerender } = render(
        <RemoteConnectionScreen
          screen={{ kind: "offline" }}
          desktopName="Studio Mac"
          onRetry={() => {}}
        />
      );
      expect(screen.getByText("Studio Mac is offline")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Choose another desktop" })).toBeNull();

      rerender(
        <RemoteConnectionScreen
          screen={{ kind: "offline" }}
          desktopName="Studio Mac"
          onRetry={() => {}}
          onSwitchDesktop={onSwitchDesktop}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Choose another desktop" }));
      expect(onSwitchDesktop).toHaveBeenCalledTimes(1);
    });

    it(`tells the user to update Copilot on both devices and shows both versions (${ISSUE})`, () => {
      render(
        <RemoteConnectionScreen
          screen={{
            kind: "version_mismatch",
            local: { app: "4.0.12", protocol: 1 },
            remote: { app: "4.1.0", protocol: 2 },
          }}
          desktopName="Studio Mac"
          onRetry={() => {}}
        />
      );

      expect(screen.getByText("Update Copilot on both devices")).not.toBeNull();
      const detail = screen.getByRole("alert").textContent ?? "";
      expect(detail).toContain("Copilot 4.0.12 (protocol 1)");
      expect(detail).toContain("Copilot 4.1.0 (protocol 2)");
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("shows a status, not an alert, while connecting and offers no retry", () => {
      render(
        <RemoteConnectionScreen
          screen={{ kind: "connecting" }}
          desktopName="Studio Mac"
          onRetry={() => {}}
        />
      );

      expect(screen.getByRole("status").textContent).toContain("Connecting to Studio Mac");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
