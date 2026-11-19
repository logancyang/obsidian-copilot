import { CustomAgentsUpsellContent, CustomAgentsUpsellModal } from "@/agents/ui/CustomAgentsUpsell";
import { AppContext } from "@/context";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";

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
    it("says why an agent answers well and lists the three things it does", () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} clipUrl="" />
      );

      expect(
        screen.getByText("Each agent gives its best answer from its own instructions and memory.")
      ).toBeTruthy();
      expect(Array.from(container.querySelectorAll("li"), (li) => li.textContent)).toEqual([
        "Correct an agent once and it remembers the rule",
        "@ another agent for a second opinion or to hand off a task",
        "Each agent's instructions and memory are notes in your vault you can edit",
      ]);
    });

    it(`shows no clip while the clip URL is empty (${ISSUE})`, () => {
      renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={jest.fn()} clipUrl="" />
      );

      expect(screen.queryByRole("img")).toBeNull();
    });

    it("shows the clip below the points once it has a URL", () => {
      const { container } = renderContent(
        <CustomAgentsUpsellContent
          medium="custom_agent_dialog"
          onClose={jest.fn()}
          clipUrl="https://example.invalid/custom-agents.webp"
        />
      );

      const clip = screen.getByRole("img");
      expect(clip.getAttribute("src")).toBe("https://example.invalid/custom-agents.webp");
      const points = container.querySelector("ul") as HTMLElement;
      expect(points.compareDocumentPosition(clip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each(["custom_agent_dialog", "custom_agent_mention"] as const)(
      "opens the pricing page tagged with the %s medium from See plans and closes",
      (medium) => {
        const onClose = jest.fn();
        renderContent(<CustomAgentsUpsellContent medium={medium} onClose={onClose} clipUrl="" />);

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
      renderContent(
        <CustomAgentsUpsellContent medium="custom_agent_dialog" onClose={onClose} clipUrl="" />
      );

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
      it("titles the dialog with Custom Agent highlighted as a preview for Supporters", () => {
        const modal = new CustomAgentsUpsellModal(new App(), "custom_agent_dialog");

        expect(modal.titleEl.textContent).toBe("Custom Agent is a preview for Supporters");
        const highlighted = modal.titleEl.querySelector(".tw-text-accent");
        expect(highlighted?.textContent).toBe("Custom Agent");
      });
    });
  });
});
