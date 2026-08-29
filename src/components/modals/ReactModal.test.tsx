import {
  FULL_BLEED_MODAL_CLASS,
  FullBleedReactModal,
  ReactModal,
} from "@/components/modals/ReactModal";
import { App } from "obsidian";
import React from "react";

class TestModal extends ReactModal {
  protected renderContent(): React.ReactElement {
    return <p>body</p>;
  }
}

class TestFullBleedModal extends FullBleedReactModal {
  protected renderContent(): React.ReactElement {
    return <p>body</p>;
  }
}

describe("ReactModal", () => {
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
        const modal = new TestModal(new App(), undefined, FULL_BLEED_MODAL_CLASS);

        expect(modal.modalEl.classList.contains(FULL_BLEED_MODAL_CLASS)).toBe(true);
        expect(modal.contentEl.classList.contains(FULL_BLEED_MODAL_CLASS)).toBe(false);
      });

      it("adds no class to the frame when none is given", () => {
        const modal = new TestModal(new App());

        expect(modal.modalEl.className).toBe("modal");
      });
    });
  });

  describe("FullBleedReactModal", () => {
    describe("constructor()", () => {
      it("applies the shared frame class before the modal is opened", () => {
        const modal = new TestFullBleedModal(new App());

        // Obsidian attaches containerEl to the document before onOpen runs, so
        // styling the frame any later can expose an unstyled first paint.
        expect(modal.containerEl.isConnected).toBe(false);
        expect(modal.modalEl.className).toBe(`modal ${FULL_BLEED_MODAL_CLASS}`);
      });
    });
  });
});
