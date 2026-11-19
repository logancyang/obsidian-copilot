import { AgentFace } from "@/agents/ui/AgentFace";
import { render } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";

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
  });
});
