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
    it("explains what the Navigator does above its highlight GIF for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      const { container } = render(<NavigatorUpsellContent onUpgrade={jest.fn()} />);

      const intro = screen.getByText(/keeps all your agent chats in one sidebar/);
      const gif = screen.getByRole("img");
      expect(gif.getAttribute("src")).toBe(NAVIGATOR_HIGHLIGHT_GIF_URL);
      expect(intro.compareDocumentPosition(gif) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(Array.from(container.querySelectorAll("li"), (li) => li.textContent)).toEqual([
        "See every chat at a glance, grouped into Pinned, Projects and Recents",
        "Keep each Project's chats together in its own folder",
        "Spot which chats are running, waiting for you, or have a new result",
        "Pin, archive, search and reorder chats without leaving your conversation",
      ]);
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
      it("titles the dialog with the upgrade message for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
        const modal = new NavigatorUpsellModal(new App());

        expect(modal.titleEl.textContent).toBe("Upgrade to Plus to use Copilot Navigator");
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
