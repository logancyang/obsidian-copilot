import {
  AgentRoster,
  type LockedRoster,
  NewAgentButton,
  type RosterAgent,
} from "@/agents/ui/AgentRoster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { useState } from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/588";
const CREATE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";
const LOCKED_AGENTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";
const HEADING_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/978";

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
const SIX = [...FIVE, agent("Ada")];
const TWELVE = [...SIX, ...["Bo", "Cy", "Di", "Ed", "Fay", "Gus"].map((n) => agent(n))];
const NEW_BUTTON = <button type="button">New</button>;

interface RenderOptions {
  agents?: readonly RosterAgent[];
  selectedSlug?: string | null;
  width?: number;
  newAgentButton?: React.ReactNode;
  onOpenProfile?: (slug: string) => void;
  locked?: LockedRoster;
  needsSetup?: ReadonlySet<string>;
}

function renderRoster({
  agents = [COCO, MAYA, LEO],
  selectedSlug = null,
  width = 400,
  newAgentButton,
  onOpenProfile,
  locked,
  needsSetup,
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
        locked={locked}
        needsSetup={needsSetup}
      />
    </TooltipProvider>
  );
  return { onSelect, unmount };
}

function StatefulRoster({ agents }: { agents: readonly RosterAgent[] }) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  return (
    <TooltipProvider>
      <AgentRoster
        agents={agents}
        selectedSlug={selectedSlug}
        onSelect={setSelectedSlug}
        emptyHero={null}
      />
    </TooltipProvider>
  );
}

function pickedAgent() {
  const block = screen.getByRole("group").previousElementSibling as HTMLElement;
  const nameElement = block.children[1] as HTMLElement;
  return { name: nameElement.textContent, nameElement, block, text: block.textContent };
}

function rowNames(): string[] {
  return within(screen.getByRole("group", { name: "Who do you want to talk to?" }))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
}

function openMoreMenu(count: number) {
  fireEvent.pointerDown(screen.getByRole("button", { name: `Show ${count} more teammates` }), {
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
    it(`shows Copilot's face and then each agent's face, each with its name under it, under no heading; screen readers hear the row as "Who do you want to talk to?" from a hidden label, with no aria-label that Obsidian would show as the whole row's tooltip (${HEADING_ISSUE})`, () => {
      renderRoster({ newAgentButton: <NewAgentButton onClick={jest.fn()} /> });

      const row = screen.getByRole("group", { name: "Who do you want to talk to?" });
      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.getByText("Who do you want to talk to?").closest("[hidden]")).not.toBeNull();
      expect(row.closest("[aria-label]")).toBeNull();
      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo", "New teammate"]);
    });

    it(`marks the selected agent in the row with a 2px accent ring on its 42px face (${ISSUE})`, () => {
      renderRoster({ selectedSlug: "maya" });

      const maya = screen.getByRole("button", { name: "Maya", pressed: true });
      expect(maya.querySelector("img")?.className).toContain("tw-size-[42px]");
      expect(maya.querySelector("img")?.className).toContain("tw-outline-2");
      expect(maya.querySelector("img")?.className).toContain(
        "tw-outline-[color:var(--interactive-accent)]"
      );
      expect(
        screen.getByRole("button", { name: "Coco", pressed: false }).querySelector("img")?.className
      ).not.toContain("tw-outline");
      expect(screen.getByRole("button", { name: "Copilot", pressed: false })).not.toBeNull();
    });

    it(`shows the selected agent above the row with its 88px face, its name and its title (${ISSUE})`, () => {
      renderRoster({ selectedSlug: "maya" });

      const picked = pickedAgent();
      expect(picked.name).toBe("Maya");
      const face = picked.block.querySelector("img");
      expect(face?.getAttribute("src")).toBe(MAYA.faceSrc);
      expect(face?.className).toContain("tw-size-[88px]");
      expect(face?.className).not.toContain("tw-outline");
      expect(picked.text).toContain("Product critic. Pushes back on plans");
      expect(
        picked.block.compareDocumentPosition(screen.getByRole("group")) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it(`names the picked agent to a screen reader once, as the pressed face in the row, while the name above the row stays visual (${ISSUE})`, () => {
      renderRoster({ selectedSlug: "maya", onOpenProfile: jest.fn() });

      expect(screen.queryByRole("heading", { name: "Maya" })).toBeNull();
      expect(pickedAgent().nameElement.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByText("Product critic. Pushes back on plans")).not.toBeNull();
      expect(
        screen
          .getAllByRole("button", { name: /Maya/ })
          .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      ).toEqual(["Open Maya's profile", "Maya"]);
      expect(screen.getByRole("button", { name: "Maya", pressed: true })).not.toBeNull();
    });

    it(`rings Copilot's face in the row and shows Copilot above it, named Copilot and titled as starting fresh every chat (${ISSUE})`, () => {
      renderRoster({ selectedSlug: null, onOpenProfile: jest.fn() });

      const copilot = screen.getByRole("button", { name: "Copilot", pressed: true });
      expect(copilot.firstElementChild?.className).toContain(
        "tw-outline-[color:var(--interactive-accent)]"
      );
      const picked = pickedAgent();
      expect(picked.name).toBe("Copilot");
      expect(picked.block.querySelector("img")).toBeNull();
      expect(picked.block.querySelector("svg")).not.toBeNull();
      expect(picked.text).toContain("Starts fresh every chat.");
    });

    it(`shrinks the picked agent's face, and Copilot's, to 64px in a window up to 640px tall so the row and chat input stay in view (${ISSUE})`, () => {
      const { unmount } = renderRoster({ selectedSlug: "maya" });
      expect(pickedAgent().block.querySelector("img")?.className).toContain(
        "[@media(max-height:640px)]:tw-size-16"
      );
      unmount();

      renderRoster({ selectedSlug: null });
      expect(pickedAgent().block.firstElementChild?.className).toContain(
        "[@media(max-height:640px)]:tw-size-16"
      );
    });

    it(`shows each newly picked agent above the row, whether picked in the row or from the More menu (${ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
      render(<StatefulRoster agents={FIVE} />);
      expect(pickedAgent().name).toBe("Copilot");

      fireEvent.click(screen.getByRole("button", { name: "Coco" }));
      expect(pickedAgent().name).toBe("Coco");
      expect(pickedAgent().text).toContain("Keeps the whole vault in view");

      openMoreMenu(2);
      fireEvent.click(screen.getByRole("menuitem", { name: /Kai/ }));
      expect(pickedAgent().name).toBe("Kai");
      expect(pickedAgent().text).toContain("Kai's job");

      fireEvent.click(screen.getByRole("button", { name: "Copilot" }));
      expect(pickedAgent().name).toBe("Copilot");
    });

    it(`cuts a long name above the row to one line and its long title to two lines (${ISSUE})`, () => {
      const long = agent(
        "Nora · Family & School and everything after school",
        "Family calendar and school logistics, from pickups to permission slips and the winter break rota"
      );
      renderRoster({ agents: [long], selectedSlug: long.slug });

      const { name, nameElement } = pickedAgent();
      expect(name).toBe(long.name);
      expect(nameElement.className).toContain("tw-truncate");
      expect(screen.getByText(long.title).className).toContain("tw-line-clamp-2");
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
      expect(screen.queryByText("Starts fresh every chat.")).toBeNull();
    });

    it(`keeps the hero it is given above a row of Copilot and the new-agent button while there are no agents yet (${CREATE_ISSUE})`, () => {
      renderRoster({ agents: [], newAgentButton: <button type="button">New</button> });

      expect(screen.getByRole("heading", { name: "What are you working on?" })).not.toBeNull();
      expect(
        within(screen.getByRole("group", { name: "What are you working on?" }))
          .getAllByRole("button")
          .map((button) => button.textContent)
      ).toEqual(["Copilot", "New"]);
      expect(screen.getByRole("button", { name: "Copilot", pressed: true })).not.toBeNull();
      expect(screen.queryByText("Starts fresh every chat.")).toBeNull();
    });

    it(`opens the selected agent's profile from its big face above the row, named Open <name>'s profile and placed before the row in the tab order (${ISSUE})`, () => {
      const onOpenProfile = jest.fn();
      renderRoster({ selectedSlug: "coco", onOpenProfile });

      const face = screen.getByRole("button", { name: "Open Coco's profile" });
      expect(face.querySelector("img")?.getAttribute("src")).toBe(COCO.faceSrc);
      expect(pickedAgent().block.firstElementChild).toBe(face);
      fireEvent.click(face);

      expect(onOpenProfile).toHaveBeenCalledWith("coco");
    });

    it(`shows the selected agent's title alone under its name, with no Profile link (${ISSUE})`, () => {
      renderRoster({ selectedSlug: "coco", onOpenProfile: jest.fn() });

      expect(pickedAgent().text).toBe("CocoKeeps the whole vault in view");
      expect(screen.queryByRole("button", { name: /^Profile/ })).toBeNull();
    });

    it(`shows a muted gear on the big face at rest that brightens while the face is hovered or keyboard-focused, and grows the face slightly on hover, inside a round focus ring (${ISSUE})`, () => {
      renderRoster({ selectedSlug: "coco", onOpenProfile: jest.fn() });

      const face = screen.getByRole("button", { name: "Open Coco's profile" });
      const gear = face.querySelector(".lucide-settings")?.parentElement;
      expect(gear?.className).toContain("tw-text-muted");
      expect(gear?.className).not.toContain("tw-opacity-0");
      expect(gear?.className).toContain("[:hover>&]:tw-text-normal");
      expect(gear?.className).toContain("[:focus-visible>&]:tw-text-normal");
      expect(face.className).toContain("motion-safe:hover:tw-scale-105");
      expect(face.className).toContain("tw-cursor-pointer");
      expect(face.className).toContain("[corner-shape:round]");
    });

    it(`shows Open profile as the big face's tooltip when it is focused (${ISSUE})`, async () => {
      renderRoster({ selectedSlug: "coco", onOpenProfile: jest.fn() });

      fireEvent.focus(screen.getByRole("button", { name: "Open Coco's profile" }));

      expect((await screen.findByRole("tooltip")).textContent).toBe("Open profile");
    });

    it(`keeps the big face a plain image while the home cannot open a profile, and Copilot's mark, which has no profile, never a button (${ISSUE})`, () => {
      const { unmount } = renderRoster({ selectedSlug: "coco" });
      expect(within(pickedAgent().block).queryByRole("button")).toBeNull();
      expect(pickedAgent().block.querySelector("img")).not.toBeNull();
      unmount();

      renderRoster({ selectedSlug: null, onOpenProfile: jest.fn() });
      expect(within(pickedAgent().block).queryByRole("button")).toBeNull();
      expect(pickedAgent().block.querySelector(".lucide-settings")).toBeNull();
    });

    it(`fits Copilot, five agents and the new-agent button in one row of a 440px sidebar (${ISSUE})`, () => {
      renderRoster({ agents: FIVE, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo", "Nora", "Kai", "New"]);
    });

    it(`fits Copilot, three agents and the new-agent button in one row of a 340px sidebar (${ISSUE})`, () => {
      renderRoster({ width: 300, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo", "New"]);
    });

    it(`fits Copilot, two agents and the new-agent button in one row of a 300px sidebar (${ISSUE})`, () => {
      renderRoster({ agents: [COCO, MAYA], width: 260, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "New"]);
    });

    it(`moves the agents that do not fit a 440px sidebar into a +N More menu, keeping Copilot and the new-agent button in the row (${ISSUE})`, () => {
      renderRoster({ agents: TWELVE, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual([
        "Copilot",
        "Coco",
        "Maya",
        "Leo",
        "Nora",
        "Show 8 more teammates",
        "New",
      ]);
    });

    it(`moves the agents that do not fit a 340px sidebar into a +N More menu (${ISSUE})`, () => {
      renderRoster({ agents: SIX, width: 300, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Show 4 more teammates", "New"]);
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
        "Show 7 more teammates",
      ]);
      expect(screen.getByRole("button", { name: "Gus", pressed: true })).not.toBeNull();
    });

    it(`keeps Copilot, the selected agent, the More menu and the new-agent button in the row of a 300px sidebar (${ISSUE})`, () => {
      renderRoster({ agents: TWELVE, selectedSlug: "gus", width: 260, newAgentButton: NEW_BUTTON });

      expect(rowNames()).toEqual(["Copilot", "Gus", "Show 11 more teammates", "New"]);
    });

    it("selects an agent picked from the More menu, which lists each agent's name and title", () => {
      const { onSelect } = renderRoster({ agents: SIX, width: 300 });

      openMoreMenu(3);
      const items = screen.getAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "NoraNora's job",
        "KaiKai's job",
        "AdaAda's job",
      ]);
      fireEvent.click(items[1]);

      expect(onSelect).toHaveBeenCalledWith("kai");
    });

    it(`shows every agent greyed with a lock while locked, keeps Copilot selected and shown above the row, says why under the row, and opens a clicked agent's locked profile instead of picking it (${LOCKED_AGENTS_ISSUE})`, () => {
      const onOpenLocked = jest.fn();
      const { onSelect } = renderRoster({
        selectedSlug: "maya",
        locked: {
          onOpen: onOpenLocked,
          note: "Your teammates need a valid Supporter license to chat.",
        },
      });

      expect(rowNames()).toEqual([
        "Copilot",
        "Coco · Supporter preview",
        "Maya · Supporter preview",
        "Leo · Supporter preview",
      ]);
      const maya = screen.getByRole("button", { name: "Maya · Supporter preview" });
      expect(maya.querySelector("img")?.className).toContain("tw-grayscale");
      expect(maya.querySelector(".lucide-lock")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Copilot", pressed: true })).not.toBeNull();
      expect(
        screen.getByText("Your teammates need a valid Supporter license to chat.")
      ).not.toBeNull();
      expect(pickedAgent().name).toBe("Copilot");

      fireEvent.click(maya);

      expect(onOpenLocked).toHaveBeenCalledWith("maya");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it(`opens the locked profile of an agent picked from the More menu, which marks each agent locked (${LOCKED_AGENTS_ISSUE})`, () => {
      const onOpenLocked = jest.fn();
      const { onSelect } = renderRoster({
        agents: SIX,
        width: 300,
        locked: { onOpen: onOpenLocked, note: null },
      });

      openMoreMenu(3);
      const items = screen.getAllByRole("menuitem");
      expect(items.map((item) => within(item).queryByLabelText("Locked"))).not.toContain(null);
      fireEvent.click(items[1]);

      expect(onOpenLocked).toHaveBeenCalledWith("kai");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it(`greys only the agents whose model can't run on this device, with the lock, and opens such an agent's profile instead of picking it (${SETUP_ISSUE})`, () => {
      const onOpenProfile = jest.fn();
      const { onSelect } = renderRoster({ onOpenProfile, needsSetup: new Set(["leo"]) });

      expect(rowNames()).toEqual(["Copilot", "Coco", "Maya", "Leo · Needs setup"]);
      const leo = screen.getByRole("button", { name: "Leo · Needs setup" });
      expect(leo.querySelector("img")?.className).toContain("tw-grayscale");
      expect(leo.querySelector(".lucide-lock")).not.toBeNull();

      fireEvent.click(leo);
      fireEvent.click(screen.getByRole("button", { name: "Maya" }));

      expect(onOpenProfile).toHaveBeenCalledWith("leo");
      expect(onSelect.mock.calls).toEqual([["maya"]]);
    });

    it(`marks and opens the profile of a setup-locked agent from the More menu (${SETUP_ISSUE})`, () => {
      const onOpenProfile = jest.fn();
      const { onSelect } = renderRoster({
        agents: SIX,
        width: 300,
        onOpenProfile,
        needsSetup: new Set(["kai"]),
      });

      openMoreMenu(3);
      const items = screen.getAllByRole("menuitem");
      expect(items.map((item) => !!within(item).queryByLabelText("Locked"))).toEqual([
        false,
        true,
        false,
      ]);
      fireEvent.click(items[1]);

      expect(onOpenProfile).toHaveBeenCalledWith("kai");
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("NewAgentButton()", () => {
    it("shows a New cell named New teammate that opens the create dialog when clicked", () => {
      const onClick = jest.fn();
      render(<NewAgentButton onClick={onClick} />);

      const button = screen.getByRole("button", { name: "New teammate" });
      expect(button.textContent).toBe("New");
      fireEvent.click(button);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it(`shows a lock on + and names it, for its hover, as a Supporter preview when locked (${LOCKED_ISSUE})`, () => {
      const onClick = jest.fn();
      render(<NewAgentButton locked onClick={onClick} />);

      const button = screen.getByRole("button", { name: "New teammate · Supporter preview" });
      expect(button.textContent).toBe("New");
      expect(button.querySelector(".lucide-lock")).not.toBeNull();
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
