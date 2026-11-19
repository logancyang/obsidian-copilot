import { AgentRoster, type RosterAgent } from "@/agents/ui/AgentRoster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/588";

function agent(name: string, title = `${name}'s job`): RosterAgent {
  return {
    slug: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    title,
    instruction: "",
    faceSrc: `data:image/svg+xml,${name}`,
  };
}

const COCO = agent("Coco", "Keeps the whole vault in view");
const MAYA = agent("Maya", "Product critic. Pushes back on plans");
const LEO = agent("Leo", "Keeps the company books");
const FIVE = [COCO, MAYA, LEO, agent("Nora"), agent("Kai")];
const TWELVE = [...FIVE, ...["Ada", "Bo", "Cy", "Di", "Ed", "Fay", "Gus"].map((n) => agent(n))];

interface RenderOptions {
  agents?: readonly RosterAgent[];
  selectedSlug?: string | null;
  width?: number;
  newAgentButton?: React.ReactNode;
  onOpenProfile?: (slug: string) => void;
}

function renderRoster({
  agents = [COCO, MAYA, LEO],
  selectedSlug = null,
  width = 424,
  newAgentButton,
  onOpenProfile,
}: RenderOptions = {}) {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const onSelect = jest.fn();
  const { unmount } = render(
    <TooltipProvider>
      <AgentRoster
        agents={agents}
        selectedSlug={selectedSlug}
        onSelect={onSelect}
        emptyHero={<h2>What are you working on?</h2>}
        newAgentButton={newAgentButton}
        onOpenProfile={onOpenProfile}
      />
    </TooltipProvider>
  );
  return { onSelect, unmount };
}

function rowNames(): string[] {
  return within(screen.getByRole("group", { name: "Who do you want to talk to?" }))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
}

function openMoreMenu(count: number) {
  fireEvent.pointerDown(screen.getByRole("button", { name: `Show ${count} more agents` }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("AgentRoster", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe("AgentRoster()", () => {
    it("asks who to talk to above Copilot's face and then each agent's face, each with its name under it", () => {
      renderRoster();

      expect(screen.getByRole("heading", { name: "Who do you want to talk to?" })).not.toBeNull();
      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo"]);
    });

    it("marks the selected agent and shows its title under the row", () => {
      renderRoster({ selectedSlug: "maya" });

      expect(screen.getByRole("button", { name: "Maya", pressed: true })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Copilot", pressed: false })).not.toBeNull();
      expect(screen.getByText("Product critic. Pushes back on plans")).not.toBeNull();
    });

    it("says Copilot has no agent and no memory when Copilot is selected", () => {
      renderRoster({ selectedSlug: null });

      expect(screen.getByRole("button", { name: "Copilot", pressed: true })).not.toBeNull();
      expect(screen.getByText("No agent, no memory")).not.toBeNull();
    });

    it("selects an agent or Copilot when its face is clicked", () => {
      const { onSelect } = renderRoster({ selectedSlug: "coco" });

      fireEvent.click(screen.getByRole("button", { name: "Leo" }));
      fireEvent.click(screen.getByRole("button", { name: "Copilot" }));

      expect(onSelect.mock.calls).toEqual([["leo"], [null]]);
    });

    it(`does nothing when the selected face is clicked again (${ISSUE})`, () => {
      const { onSelect } = renderRoster({ selectedSlug: "coco" });

      fireEvent.click(screen.getByRole("button", { name: "Coco" }));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it("shows an agent's full name and title when its face is hovered or focused", async () => {
      const longName = agent("Nora · Family & School", "Family calendar and school logistics");
      renderRoster({ agents: [longName] });

      fireEvent.focus(screen.getByRole("button", { name: "Nora · Family & School" }));

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain("Nora · Family & School");
      expect(tooltip.textContent).toContain("Family calendar and school logistics");
    });

    it(`shows the hero it is given, and no row, while there is no agent to pick (${ISSUE})`, () => {
      renderRoster({ agents: [] });

      expect(screen.getByRole("heading", { name: "What are you working on?" })).not.toBeNull();
      expect(screen.queryByRole("group")).toBeNull();
      expect(screen.queryByText("No agent, no memory")).toBeNull();
    });

    it(`links the selected agent's profile only when the home can open one (${ISSUE})`, () => {
      const onOpenProfile = jest.fn();
      renderRoster({ selectedSlug: "coco", onOpenProfile });

      fireEvent.click(screen.getByRole("button", { name: "Profile" }));

      expect(onOpenProfile).toHaveBeenCalledWith("coco");
    });

    it(`shows no profile link while the home cannot open one, or for Copilot (${ISSUE})`, () => {
      const { unmount } = renderRoster({ selectedSlug: "coco" });
      expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
      unmount();

      renderRoster({ selectedSlug: null, onOpenProfile: jest.fn() });
      expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
    });

    it("fits Copilot, five agents and the new-agent button in one row of a 440px sidebar", () => {
      renderRoster({ agents: FIVE, newAgentButton: <button type="button">New</button> });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo", "Nora", "Kai", "New"]);
    });

    it(`moves the agents that do not fit into a +N More menu, keeping Copilot and the new-agent button in the row (${ISSUE})`, () => {
      renderRoster({ agents: TWELVE, newAgentButton: <button type="button">New</button> });

      expect(rowNames()).toEqual([
        "Copilot",
        "Coco",
        "Maya",
        "Leo",
        "Nora",
        "Show 8 more agents",
        "New",
      ]);
    });

    it(`keeps the selected agent in the row when it would otherwise be in the menu (${ISSUE})`, () => {
      renderRoster({ agents: TWELVE, selectedSlug: "gus" });

      expect(rowNames()).toEqual([
        "Copilot",
        "Coco",
        "Maya",
        "Leo",
        "Nora",
        "Gus",
        "Show 7 more agents",
      ]);
      expect(screen.getByRole("button", { name: "Gus", pressed: true })).not.toBeNull();
    });

    it("moves agents into the menu in a narrow sidebar", () => {
      renderRoster({ agents: FIVE, width: 300 });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo", "Show 2 more agents"]);
    });

    it("selects an agent picked from the More menu, which lists each agent's name and title", () => {
      const { onSelect } = renderRoster({ agents: FIVE, width: 300 });

      openMoreMenu(2);
      const items = screen.getAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["NoraNora's job", "KaiKai's job"]);
      fireEvent.click(items[1]);

      expect(onSelect).toHaveBeenCalledWith("kai");
    });
  });
});
