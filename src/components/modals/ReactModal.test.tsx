import { ReactModal } from "@/components/modals/ReactModal";
import { App } from "obsidian";
import React from "react";

class TestModal extends ReactModal {
  protected renderContent(): React.ReactElement {
    return <p>body</p>;
  }
}

describe("ReactModal", () => {
  describe("constructor()", () => {
    it("leaves the native title element empty when no title is given", () => {
      const modal = new TestModal(new App());

      expect(modal.titleEl.textContent).toBe("");
    });

    it("writes the given title into the native title element", () => {
      const modal = new TestModal(new App(), "Configure Codex");

      expect(modal.titleEl.textContent).toBe("Configure Codex");
    });

    it("puts the given modal class on the frame rather than its content", () => {
      const modal = new TestModal(new App(), undefined, "copilot-config-modal");

      expect(modal.modalEl.classList.contains("copilot-config-modal")).toBe(true);
      expect(modal.contentEl.classList.contains("copilot-config-modal")).toBe(false);
    });

    it("styles the frame before it is opened, so it is never painted unstyled", () => {
      const modal = new TestModal(new App(), undefined, "copilot-config-modal");

      // The class has to land in the constructor, not in onOpen or a child's
      // effect: Obsidian attaches containerEl to the document before onOpen
      // runs, so anything later leaves a frame the user can see unstyled.
      expect(modal.containerEl.isConnected).toBe(false);
      expect(modal.modalEl.classList.contains("copilot-config-modal")).toBe(true);
    });

    it("adds no class to the frame when none is given", () => {
      const modal = new TestModal(new App());

      expect(modal.modalEl.className).toBe("modal");
    });
  });
});
