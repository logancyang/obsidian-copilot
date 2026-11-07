import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectorLogo } from "@/connectors/ui/ConnectorLogo";
import { fireEvent, render } from "@testing-library/react";
import React from "react";

const APIFY: ConnectorCatalogEntry = {
  id: "apify",
  name: "apify",
  description: "Web scrapers and their results",
  category: "Automation",
  serverUrl: "https://mcp.apify.com",
};
const APIFY_LOGO = "https://images.brevilabs.com/newsletters/copilot-plugin/connectors/apify.png";
const APIFY_NEW_LOGO =
  "https://images.brevilabs.com/newsletters/copilot-plugin/connectors/apify-2.png";

describe("ConnectorLogo", () => {
  describe("ConnectorLogo()", () => {
    it("shows the service's logo from its URL as a lazy, decorative, undraggable image", () => {
      const { container } = render(<ConnectorLogo service={{ ...APIFY, logoUrl: APIFY_LOGO }} />);

      const image = container.querySelector("img");
      expect(image?.getAttribute("src")).toBe(APIFY_LOGO);
      expect(image?.getAttribute("alt")).toBe("");
      expect(image?.getAttribute("loading")).toBe("lazy");
      expect(image?.getAttribute("draggable")).toBe("false");
      expect(container.textContent).toBe("");
    });

    it("shows a tile with the name's first letter, capitalized, when the service has no logo", () => {
      const { container } = render(<ConnectorLogo service={APIFY} />);

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("A");
    });

    it("shows the letter tile once the logo fails to load (https://github.com/Brevilabs/obsidian-copilot-private/issues/855)", () => {
      const { container } = render(<ConnectorLogo service={{ ...APIFY, logoUrl: APIFY_LOGO }} />);

      fireEvent.error(container.querySelector("img") as HTMLImageElement);

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("A");
    });

    it("tries a new logo URL after an earlier one failed (https://github.com/Brevilabs/obsidian-copilot-private/issues/855)", () => {
      const { container, rerender } = render(
        <ConnectorLogo service={{ ...APIFY, logoUrl: APIFY_LOGO }} />
      );
      fireEvent.error(container.querySelector("img") as HTMLImageElement);

      rerender(<ConnectorLogo service={{ ...APIFY, logoUrl: APIFY_NEW_LOGO }} />);

      expect(container.querySelector("img")?.getAttribute("src")).toBe(APIFY_NEW_LOGO);
    });
  });
});
