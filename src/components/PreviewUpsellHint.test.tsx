import { PreviewUpsellHint } from "@/components/PreviewUpsellHint";
import { useIsPreviewEnabled } from "@/plusUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useIsPreviewEnabled: jest.fn(),
}));

const HINT_NAME = "Preview for Believers and Supporters";
const PRICING_URL =
  "https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=preview_hint";

describe("PreviewUpsellHint", () => {
  describe("PreviewUpsellHint()", () => {
    it("shows the hint, opening the pricing page in a new tab, when the token lacks preview", () => {
      jest.mocked(useIsPreviewEnabled).mockReturnValue(false);
      render(<PreviewUpsellHint />);

      const hint = screen.getByRole("link", { name: HINT_NAME });
      fireEvent.click(hint);

      expect(hint.getAttribute("href")).toBe(PRICING_URL);
      expect(hint.getAttribute("target")).toBe("_blank");
    });

    it("renders nothing when the verified token carries preview", () => {
      jest.mocked(useIsPreviewEnabled).mockReturnValue(true);

      const { container } = render(<PreviewUpsellHint />);

      expect(container.innerHTML).toBe("");
    });
  });
});
