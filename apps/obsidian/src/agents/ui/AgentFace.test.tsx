import { AgentFace } from "@/agents/ui/AgentFace";
import { render } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";

describe("AgentFace", () => {
  describe("AgentFace()", () => {
    it("shows the face file as a round, decorative image of the requested size", () => {
      const { container } = render(<AgentFace src="face:coco" size="m" className="tw-mb-1" />);

      const face = container.firstElementChild as HTMLImageElement;
      expect(face.tagName).toBe("IMG");
      expect(face.getAttribute("src")).toBe("face:coco");
      expect(face.getAttribute("alt")).toBe("");
      expect(face.className).toContain("tw-rounded-full");
      expect(face.className).toContain("tw-size-7");
      expect(face.className).toContain("tw-mb-1");
    });

    it(`draws a spinning ring around the face while its chat runs, keeping the face visible (${ISSUE})`, () => {
      const { container } = render(
        <AgentFace src="face:leo" size="xs" running className="group-hover:tw-hidden" />
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain("group-hover:tw-hidden");
      expect(wrapper.querySelector("img")?.getAttribute("src")).toBe("face:leo");
      expect(wrapper.querySelector('[data-agent-face-ring="running"]')?.className).toContain(
        "tw-animate-spin"
      );
    });

    it("draws no running ring while the chat is idle", () => {
      const { container } = render(<AgentFace src="face:leo" size="xs" />);

      expect(container.querySelector('[data-agent-face-ring="running"]')).toBeNull();
    });

    it(`greys a locked agent's face and puts a lock on its corner (${LOCKED_ISSUE})`, () => {
      const { container } = render(
        <AgentFace src="face:maya" size="l" locked className="tw-mb-1" />
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain("tw-mb-1");
      const face = wrapper.querySelector("img") as HTMLImageElement;
      expect(face.getAttribute("src")).toBe("face:maya");
      expect(face.className).toContain("tw-grayscale");
      expect(wrapper.querySelector(".lucide-lock")).not.toBeNull();
    });

    it(`rings a selected face in the theme's accent color, 3px wide on a picker-sized face (https://github.com/Brevilabs/obsidian-copilot-private/issues/588)`, () => {
      const { container } = render(<AgentFace src="face:maya" size="l" selected />);

      const face = container.querySelector("img") as HTMLImageElement;
      expect(face.className).toContain("tw-size-9");
      expect(face.className).toContain("tw-outline-[3px]");
      expect(face.className).toContain("tw-outline-[color:var(--interactive-accent)]");
    });

    it(`rings a selected 42px row face 2px wide so the ring stays clear of the next face (https://github.com/Brevilabs/obsidian-copilot-private/issues/588)`, () => {
      const { container } = render(<AgentFace src="face:maya" size="roster" selected />);

      const face = container.querySelector("img") as HTMLImageElement;
      expect(face.className).toContain("tw-size-[42px]");
      expect(face.className).toContain("tw-outline-2");
      expect(face.className).not.toContain("tw-outline-[3px]");
      expect(face.className).toContain("tw-outline-[color:var(--interactive-accent)]");
    });

    it("draws an unlocked face in full colour with no lock", () => {
      const { container } = render(<AgentFace src="face:maya" size="l" />);

      expect(container.querySelector("img")?.className).not.toContain("tw-grayscale");
      expect(container.querySelector(".lucide-lock")).toBeNull();
    });
  });
});
