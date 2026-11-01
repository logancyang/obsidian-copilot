import {
  NAVIGATOR_HIGHLIGHT_GIF_URL,
  NavigatorBlockedNotice,
  NavigatorUpsellContent,
  NavigatorUpsellModal,
} from "@/agentMode/ui/NavigatorUpsell";
import { ReactModal } from "@/components/modals/ReactModal";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

function openedUtmMedium(open: jest.SpyInstance): string | null {
  const [url] = open.mock.calls[0] as [string];
  return new URL(url).searchParams.get("utm_medium");
}

describe("NavigatorUpsell", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    open.mockRestore();
  });

  describe("NavigatorUpsellContent()", () => {
    it("previews the Navigator with its highlight GIF and says it is for Plus users for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      render(<NavigatorUpsellContent onUpgrade={jest.fn()} />);

      expect(screen.getByRole("img").getAttribute("src")).toBe(NAVIGATOR_HIGHLIGHT_GIF_URL);
      expect(
        screen.getByText(
          "Navigator gives you a more flexible way to manage your long sessions, available for Plus users."
        )
      ).toBeTruthy();
    });

    it("opens the pricing page tagged with the navigator_dialog medium and reports the upgrade for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      const onUpgrade = jest.fn();
      render(<NavigatorUpsellContent onUpgrade={onUpgrade} />);

      fireEvent.click(screen.getByRole("button", { name: /Upgrade to Plus/ }));

      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("https://www.obsidiancopilot.com/pricing"),
        "_blank"
      );
      expect(openedUtmMedium(open)).toBe("navigator_dialog");
      expect(onUpgrade).toHaveBeenCalledTimes(1);
    });
  });

  describe("NavigatorUpsellModal", () => {
    afterEach(() => document.body.replaceChildren());

    describe("constructor()", () => {
      it("titles the dialog as a Plus feature for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
        const modal = new NavigatorUpsellModal(new App());

        expect(modal.titleEl.textContent).toBe("Copilot Navigator is a Plus feature");
      });
    });

    describe("onOpen()", () => {
      it("closes the dialog after sending the user to the pricing page for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
        const modal = new NavigatorUpsellModal(new App());
        modal.contentEl.empty = () => modal.contentEl.replaceChildren();
        document.body.appendChild(modal.containerEl);
        await act(async () => ReactModal.prototype.onOpen.call(modal));

        fireEvent.click(within(modal.contentEl).getByRole("button", { name: /Upgrade to Plus/ }));

        expect(openedUtmMedium(open)).toBe("navigator_dialog");
        expect(modal.close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });

  describe("NavigatorBlockedNotice()", () => {
    it("tells the user the Navigator is for Plus users only for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      render(<NavigatorBlockedNotice />);

      expect(screen.getByText("Copilot Navigator is for Plus users only")).toBeTruthy();
    });

    it("opens the pricing page tagged with the navigator_blocked_view medium for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      render(<NavigatorBlockedNotice />);

      fireEvent.click(screen.getByRole("button", { name: /Upgrade to Plus/ }));

      expect(openedUtmMedium(open)).toBe("navigator_blocked_view");
    });
  });
});
