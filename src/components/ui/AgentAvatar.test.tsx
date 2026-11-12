import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { AgentAvatar, agentInitial } from "./AgentAvatar";
import { AgentGlyph } from "./AgentGlyph";

describe("AgentAvatar", () => {
  describe("AgentAvatar()", () => {
    it("draws the agent's uploaded image when it has one", () => {
      const { container } = render(
        <AgentAvatar src="app://sage/avatar.webp" name="Sage" size="md" />
      );
      expect(container.querySelector("img")?.getAttribute("src")).toBe("app://sage/avatar.webp");
      expect(container.textContent).toBe("");
    });

    it("draws the name's initial when the agent has no image", () => {
      const { container } = render(<AgentAvatar src={null} name="sage" size="md" />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("S");
    });

    it("draws the given fallback in place of the initial, as Copilot's brand mark", () => {
      const { container } = render(
        <AgentAvatar src={null} name="Copilot" size="xl" fallback={<svg data-testid="mark" />} />
      );
      expect(container.querySelector("[data-testid='mark']")).toBeTruthy();
      expect(container.textContent).toBe("");
    });

    it("falls back to the initial when the image file fails to load, as after a sync drops it", () => {
      const { container } = render(<AgentAvatar src="app://gone.webp" name="Sage" size="md" />);
      fireEvent.error(container.querySelector("img")!);
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("S");
    });

    it("tries a replaced image again after the previous one failed", () => {
      const { container, rerender } = render(
        <AgentAvatar src="app://old.webp" name="Sage" size="md" />
      );
      fireEvent.error(container.querySelector("img")!);

      rerender(<AgentAvatar src="app://new.webp" name="Sage" size="md" />);

      expect(container.querySelector("img")?.getAttribute("src")).toBe("app://new.webp");
    });
  });

  describe("agentInitial()", () => {
    it("is the name's first letter, upper-cased, ignoring leading space", () => {
      expect(agentInitial("  jennifer")).toBe("J");
    });

    it("is a question mark for a blank name, so the circle is never empty", () => {
      expect(agentInitial("   ")).toBe("?");
    });
  });

  describe("AgentGlyph()", () => {
    it("draws the profile image in the glyph box when one is given", () => {
      const { container } = render(<AgentGlyph name="Sage" avatarSrc="app://sage/avatar.webp" />);
      expect(container.querySelector("img")?.getAttribute("src")).toBe("app://sage/avatar.webp");
    });

    it("draws the initial when no image is given or the image fails", () => {
      const { container, rerender } = render(<AgentGlyph name="Sage" />);
      expect(container.textContent).toBe("S");

      rerender(<AgentGlyph name="Sage" avatarSrc="app://gone.webp" />);
      fireEvent.error(container.querySelector("img")!);

      expect(container.textContent).toBe("S");
    });
  });
});
