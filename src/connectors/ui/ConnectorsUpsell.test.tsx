import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { ConnectorsUpsell } from "@/connectors/ui/ConnectorsUpsell";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderUpsell() {
  const onEnterLicenseKey = jest.fn();
  const onSeePlans = jest.fn();
  render(<ConnectorsUpsell onEnterLicenseKey={onEnterLicenseKey} onSeePlans={onSeePlans} />);
  return { onEnterLicenseKey, onSeePlans };
}

function serviceNames(): string[] {
  return screen
    .getAllByRole("listitem", { name: /./ })
    .map((item) => item.getAttribute("aria-label") ?? "");
}

describe("ConnectorsUpsell", () => {
  describe("ConnectorsUpsell()", () => {
    it("explains that connectors are a Supporter preview and what they give every agent", () => {
      renderUpsell();

      expect(
        screen.getByRole("heading", { name: "PREVIEW Connectors is a preview for Supporters" })
      ).toBeTruthy();
      expect(screen.getByText("Works with Claude, Codex and OpenCode.")).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: `${CONNECTOR_CATALOG.length} connectors available` })
      ).toBeTruthy();
    });

    it("sends the user to the license key or the plans", () => {
      const { onEnterLicenseKey, onSeePlans } = renderUpsell();

      fireEvent.click(
        screen.getByRole("button", { name: "Already a Supporter? Enter your license key" })
      );
      fireEvent.click(screen.getByRole("button", { name: "See plans" }));

      expect(onEnterLicenseKey).toHaveBeenCalledTimes(1);
      expect(onSeePlans).toHaveBeenCalledTimes(1);
    });

    it("previews a few well-known services, then lists the whole catalog on request", () => {
      renderUpsell();

      expect(serviceNames()).toEqual([
        "Notion",
        "Linear",
        "Atlassian",
        "Todoist",
        "Granola",
        "Readwise",
      ]);

      fireEvent.click(
        screen.getByRole("button", { name: `See all ${CONNECTOR_CATALOG.length} connectors` })
      );

      expect(serviceNames()).toHaveLength(CONNECTOR_CATALOG.length);
      expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
    });
  });
});
