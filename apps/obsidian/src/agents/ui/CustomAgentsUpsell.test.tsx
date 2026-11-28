import {
  COPILOT_TEAMMATES_VIDEO,
  CustomAgentsUpsellContent,
  CustomAgentsUpsellModal,
} from "@/agents/ui/CustomAgentsUpsell";
import { AppContext } from "@/context";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/979";

function renderContent(element: React.ReactElement) {
  return render(<AppContext.Provider value={new App()}>{element}</AppContext.Provider>);
}

describe("CustomAgentsUpsell", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    open.mockRestore();
  });

  describe("CustomAgentsUpsellContent()", () => {
    it("says what a teammate is for, that it is a preview for Supporters, and lists three things teammates do", () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} video={null} />
      );

      expect(
        screen.getByText(
          "Make a teammate for each kind of work you do, like an editor for your drafts, a researcher for your sources or a planner for your weekly review. Each one has its own instructions and memory. Copilot Teammates is a preview for Supporters."
        )
      ).toBeTruthy();
      expect(Array.from(container.querySelectorAll("li"), (li) => li.textContent)).toEqual([
        "Correct a teammate or tell it how you like things done, and it remembers next time",
        "@ another teammate for a second opinion or to hand off part of the work",
        "Change how a teammate works by editing its instructions in your vault",
      ]);
    });

    it("shows the launch video thumbnail below the points, linking to the video on YouTube", () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} />
      );

      const link = screen.getByRole("link", { name: "Watch the video on YouTube" });
      expect(link.getAttribute("href")).toBe(COPILOT_TEAMMATES_VIDEO.url);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        COPILOT_TEAMMATES_VIDEO.thumbnailUrl
      );
      const points = container.querySelector("ul") as HTMLElement;
      expect(points.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("shows another video by its own address and thumbnail", () => {
      renderContent(
        <CustomAgentsUpsellContent
          medium="custom_agent_dialog"
          onClose={jest.fn()}
          video={{
            url: "https://www.youtube.com/watch?v=walkthrough",
            thumbnailUrl: "https://example.invalid/walkthrough.webp",
          }}
        />
      );

      const link = screen.getByRole("link", { name: "Watch the video on YouTube" });
      expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=walkthrough");
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        "https://example.invalid/walkthrough.webp"
      );
    });

    it("shows no video area when no video is set", () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} video={null} />
      );

      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
    });

    it(`removes the video area when the thumbnail fails to load, such as offline (${ISSUE})`, () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} />
      );

      fireEvent.error(container.querySelector("img") as HTMLImageElement);

      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByRole("button", { name: /See plans/ })).toBeTruthy();
    });

    it.each(["custom_agent_dialog", "custom_agent_mention"] as const)(
      "opens the pricing page tagged with the %s medium from See plans and closes",
      (medium) => {
        const onClose = jest.fn();
        renderContent(<CustomAgentsUpsellContent medium={medium} onClose={onClose} />);

        fireEvent.click(screen.getByRole("button", { name: /See plans/ }));

        expect(open).toHaveBeenCalledWith(
          `https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=${medium}`,
          "_blank"
        );
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    );

    it("opens the license key field in settings from Already a Supporter and closes", () => {
      const onClose = jest.fn();
      renderContent(<CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={onClose} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Already a Supporter? Enter your license key" })
      );

      expect(openCopilotSettings).toHaveBeenCalledWith(expect.anything(), window, "basic");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("CustomAgentsUpsellModal", () => {
    describe("constructor()", () => {
      it("titles the dialog with what Copilot Teammates gives, the name highlighted", () => {
        const modal = new CustomAgentsUpsellModal(new App(), "custom_agent_dialog");

        expect(modal.titleEl.textContent).toBe("Build your AI team with Copilot Teammates");
        const highlighted = modal.titleEl.querySelector(".tw-text-accent");
        expect(highlighted?.textContent).toBe("Copilot Teammates");
      });
    });
  });
});
