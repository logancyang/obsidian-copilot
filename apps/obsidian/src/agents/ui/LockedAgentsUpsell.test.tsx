import { LockedAgentsUpsellContent, LockedAgentsUpsellModal } from "@/agents/ui/LockedAgentsUpsell";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const FOUR = [COCO, MAYA, LEO, NORA];

function renderContent(agents = FOUR) {
  const onClose = jest.fn();
  const app = new App();
  render(
    <AppContext.Provider value={app}>
      <LockedAgentsUpsellContent agents={agents} onClose={onClose} />
    </AppContext.Provider>
  );
  return { app, onClose };
}

function buttonNames(): string[] {
  return screen.getAllByRole("button").map((button) => button.textContent?.trim() ?? "");
}

describe("LockedAgentsUpsell", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => open.mockRestore());

  describe("LockedAgentsUpsellContent()", () => {
    it(`shows the vault's faces, says they keep their instructions and memory and need a valid Supporter license, and leads with Enter license key after See plans (${ISSUE})`, () => {
      const { app, onClose } = renderContent();

      expect(
        screen.getAllByRole("img", { hidden: true }).map((img) => img.getAttribute("src"))
      ).toEqual(FOUR.map((agent) => agent.faceSrc));
      expect(
        screen.getByText(
          "Coco, Maya, Leo and Nora keep their instructions and memory. You need a valid Supporter license to activate them again."
        )
      ).not.toBeNull();
      expect(buttonNames()).toEqual(["See plans", "Enter license key"]);
      expect(screen.getByRole("button", { name: "Enter license key" }).className).toContain(
        "mod-cta"
      );

      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`names the vault's one agent (${ISSUE})`, () => {
      renderContent([MAYA]);

      expect(
        screen.getByText(
          "Maya keeps its instructions and memory. You need a valid Supporter license to activate it again."
        )
      ).not.toBeNull();
    });

    it(`opens the pricing page tagged custom_agent_synced from See plans and closes (${ISSUE})`, () => {
      const { onClose } = renderContent();

      fireEvent.click(screen.getByRole("button", { name: "See plans" }));

      const [url] = open.mock.calls[0] as [string];
      expect(url).toContain("https://www.obsidiancopilot.com/pricing");
      expect(new URL(url).searchParams.get("utm_medium")).toBe("custom_agent_synced");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("LockedAgentsUpsellModal", () => {
    describe("constructor()", () => {
      it(`titles the dialog by how many custom agents the vault has (${ISSUE})`, () => {
        expect(new LockedAgentsUpsellModal(new App(), FOUR).titleEl.textContent).toBe(
          "This vault has 4 teammates"
        );
        expect(new LockedAgentsUpsellModal(new App(), [MAYA]).titleEl.textContent).toBe(
          "This vault has 1 teammate"
        );
      });
    });
  });
});
