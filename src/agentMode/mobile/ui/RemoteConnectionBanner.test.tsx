import { RemoteConnectionBanner } from "@/agentMode/mobile/ui/RemoteConnectionBanner";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("RemoteConnectionBanner", () => {
  describe("RemoteConnectionBanner()", () => {
    it("shows reconnecting progress without a retry button", () => {
      render(
        <RemoteConnectionBanner banner="reconnecting" desktopName="Studio Mac" onRetry={() => {}} />
      );
      expect(screen.getByRole("status").textContent).toContain("Reconnecting to Studio Mac");
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it.each([
      ["offline", "Studio Mac is offline. Retrying…"],
      ["unreachable", "Can't reach your desktop. Is Tailscale on?"],
    ] as const)("explains a %s desktop and lets the user retry at once", (banner, text) => {
      const onRetry = jest.fn();
      render(<RemoteConnectionBanner banner={banner} desktopName="Studio Mac" onRetry={onRetry} />);

      expect(screen.getByRole("status").textContent).toContain(text);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
