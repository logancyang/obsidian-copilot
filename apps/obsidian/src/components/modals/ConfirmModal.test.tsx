import { ConfirmModalContent } from "@/components/modals/ConfirmModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderContent(confirmButtonVariant?: "destructive") {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(
    <ConfirmModalContent
      content="Disconnect Notion?"
      confirmButtonText="Disconnect"
      cancelButtonText="Cancel"
      confirmButtonVariant={confirmButtonVariant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  return { onConfirm, onCancel };
}

describe("ConfirmModal", () => {
  describe("ConfirmModalContent()", () => {
    it("shows the question and calls back on the button the user picks", () => {
      const { onConfirm, onCancel } = renderContent();
      expect(screen.getByText("Disconnect Notion?")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 focuses Cancel when it opens, so a keyboard user starts on the safe choice", () => {
      renderContent("destructive");

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    });

    it("draws the confirm button in the accent color unless the action is destructive", () => {
      renderContent();
      expect(screen.getByRole("button", { name: "Disconnect" }).className).toContain("mod-cta");
    });

    it("draws a destructive confirm button in the error color", () => {
      renderContent("destructive");
      const confirm = screen.getByRole("button", { name: "Disconnect" });
      expect(confirm.className).toContain("tw-bg-modifier-error");
      expect(confirm.className).not.toContain("mod-cta");
    });
  });
});
