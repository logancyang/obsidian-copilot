import {
  NAVIGATOR_HIGHLIGHT_GIF_URL,
  NavigatorBlockedNotice,
  NavigatorUpsellContent,
  NavigatorUpsellModal,
} from "@/agentMode/ui/NavigatorUpsell";
import { ReactModal } from "@/components/modals/ReactModal";
import { AppContext } from "@/context";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

function openedUtmMedium(open: jest.SpyInstance): string | null {
  const [url] = open.mock.calls[0] as [string];
  return new URL(url).searchParams.get("utm_medium");
}

function renderWithApp(app: App, element: React.ReactElement) {
  return render(<AppContext.Provider value={app}>{element}</AppContext.Provider>);
}

describe("NavigatorUpsell", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    open.mockRestore();
  });

  describe("NavigatorUpsellContent()", () => {
    it("explains what the Navigator does above its highlight GIF for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      const { container } = renderWithApp(
        new App(),
        <NavigatorUpsellContent onClose={jest.fn()} />
      );

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

    it("opens the pricing page tagged with the navigator_dialog medium and asks to close for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      const onClose = jest.fn();
      renderWithApp(new App(), <NavigatorUpsellContent onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: /See plans/ }));

      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("https://www.obsidiancopilot.com/pricing"),
        "_blank"
      );
      expect(openedUtmMedium(open)).toBe("navigator_dialog");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("opens the Copilot settings tab holding the license key field and asks to close for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      const app = new App();
      const onClose = jest.fn();
      renderWithApp(app, <NavigatorUpsellContent onClose={onClose} />);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Already a Believer or Supporter? Enter your license key",
        })
      );

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("NavigatorUpsellModal", () => {
    afterEach(() => document.body.replaceChildren());

    async function openModal(): Promise<NavigatorUpsellModal> {
      const modal = new NavigatorUpsellModal(new App());
      modal.contentEl.empty = () => modal.contentEl.replaceChildren();
      document.body.appendChild(modal.containerEl);
      await act(async () => ReactModal.prototype.onOpen.call(modal));
      return modal;
    }

    describe("constructor()", () => {
      it("titles the dialog as a preview for Believers and Supporters for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
        const modal = new NavigatorUpsellModal(new App());

        expect(modal.titleEl.textContent).toBe(
          "Copilot Navigator is a preview for Believers and Supporters"
        );
      });
    });

    describe("onOpen()", () => {
      it("closes the dialog after sending the user to the pricing page for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
        const modal = await openModal();

        fireEvent.click(within(modal.contentEl).getByRole("button", { name: /See plans/ }));

        expect(openedUtmMedium(open)).toBe("navigator_dialog");
        expect(modal.close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });

      it("closes the dialog after opening Copilot settings for the license key for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
        const modal = await openModal();

        fireEvent.click(
          within(modal.contentEl).getByRole("button", {
            name: "Already a Believer or Supporter? Enter your license key",
          })
        );

        expect(openCopilotSettings).toHaveBeenCalledWith(modal.app, window, "basic");
        expect(modal.close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });

  describe("NavigatorBlockedNotice()", () => {
    it("tells the user their preview access ended, who the preview is for, and where their chats still are for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      renderWithApp(new App(), <NavigatorBlockedNotice onClose={jest.fn()} />);

      expect(screen.getByText("Your preview access ended")).toBeTruthy();
      expect(
        screen.getByText(
          "Copilot Navigator is a preview for Believers and Supporters. Your chats are still under Recent chats in Agent Chat."
        )
      ).toBeTruthy();
    });

    it("opens the pricing page tagged with the navigator_blocked_view medium from See plans for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      renderWithApp(new App(), <NavigatorBlockedNotice onClose={jest.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: /See plans/ }));

      expect(openedUtmMedium(open)).toBe("navigator_blocked_view");
    });

    it("opens the Copilot settings tab holding the license key field and keeps the panel for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      const app = new App();
      const onClose = jest.fn();
      renderWithApp(app, <NavigatorBlockedNotice onClose={onClose} />);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Already a Believer or Supporter? Enter your license key",
        })
      );

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("asks to close the panel from Close for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      const onClose = jest.fn();
      renderWithApp(new App(), <NavigatorBlockedNotice onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    });
  });
});
