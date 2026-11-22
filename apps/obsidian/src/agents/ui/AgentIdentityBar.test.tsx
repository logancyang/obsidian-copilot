import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentIdentityBar } from "@/agents/ui/AgentIdentityBar";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";

function agent(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "coco",
    name: "Coco",
    title: "Keeps the whole vault in view",
    instruction: "You keep the whole vault in view. Answer briefly.",
    faceSrc: "face:coco",
    ...overrides,
  } as CustomAgent;
}

describe("AgentIdentityBar", () => {
  describe("AgentIdentityBar()", () => {
    it("shows the agent's face, its name and its title, with no model", () => {
      const { container } = render(<AgentIdentityBar agent={agent()} />);

      expect(container.querySelector("img")?.getAttribute("src")).toBe("face:coco");
      expect(screen.getByText("Coco")).not.toBeNull();
      expect(screen.getByText("Keeps the whole vault in view")).not.toBeNull();
      expect(container.textContent).toBe("CocoKeeps the whole vault in view");
    });

    it(`cuts a long name and a long title to one line each (${ISSUE})`, () => {
      render(
        <AgentIdentityBar
          agent={agent({
            name: "Nora · Family & School Logistics Coordinator",
            title: "Family calendar and school logistics, from pickups to permission slips",
          })}
        />
      );

      expect(screen.getByText("Nora · Family & School Logistics Coordinator").className).toContain(
        "tw-truncate"
      );
      expect(
        screen.getByText("Family calendar and school logistics, from pickups to permission slips")
          .className
      ).toContain("tw-truncate");
    });

    it(`shows the instruction's first sentence when the agent has no title (${ISSUE})`, () => {
      render(<AgentIdentityBar agent={agent({ title: "" })} />);

      expect(screen.getByText("You keep the whole vault in view.")).not.toBeNull();
    });

    it(`shows only the name when the agent has neither a title nor an instruction (${ISSUE})`, () => {
      const { container } = render(
        <AgentIdentityBar agent={agent({ title: "", instruction: "" })} />
      );

      expect(container.textContent).toBe("Coco");
    });

    it(`is not clickable and shows no arrow until the chat can open the agent's profile (${ISSUE})`, () => {
      const { container } = render(<AgentIdentityBar agent={agent()} />);

      expect(screen.queryByRole("button")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();
    });

    it(`opens the agent's profile from the whole bar, marked by an arrow, when the chat can open one (${ISSUE})`, () => {
      const onOpenProfile = jest.fn();
      const { container } = render(
        <AgentIdentityBar agent={agent()} onOpenProfile={onOpenProfile} />
      );

      fireEvent.click(screen.getByRole("button", { name: "Open Coco's profile" }));

      expect(onOpenProfile).toHaveBeenCalledWith("coco");
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });
});
