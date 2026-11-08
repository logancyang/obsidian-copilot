import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ApiKeyStorageSection, type ApiKeyStorageStatus } from "./ApiKeyStorageSection";

function renderSection(status: ApiKeyStorageStatus, forgetting = false) {
  const onForgetAll = jest.fn();
  render(
    <ApiKeyStorageSection status={status} forgetting={forgetting} onForgetAll={onForgetAll} />
  );
  return { onForgetAll, deleteButton: screen.getByRole("button") };
}

describe("ApiKeyStorageSection", () => {
  describe("ApiKeyStorageSection()", () => {
    it("confirms stored keys and deletes them all on Delete All Keys", () => {
      const { onForgetAll, deleteButton } = renderSection("stored");

      fireEvent.click(deleteButton);

      expect(screen.getByText(/API keys are stored in this device/)).toBeTruthy();
      expect(screen.queryByText(/No API keys found/)).toBeNull();
      expect(onForgetAll).toHaveBeenCalledTimes(1);
    });

    it("asks to re-enter keys when this device's Keychain holds none", () => {
      renderSection("empty");

      expect(screen.getByText(/No API keys found in this device/)).toBeTruthy();
      expect(screen.queryByText(/API keys are stored/)).toBeNull();
    });

    it("explains the Obsidian update and disables deletion when the Keychain is unavailable", () => {
      const { onForgetAll, deleteButton } = renderSection("unavailable");

      fireEvent.click(deleteButton);

      expect(screen.getByText("Unavailable")).toBeTruthy();
      expect(screen.getByText(/Keys\s+cannot be loaded or saved in this build/)).toBeTruthy();
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
      expect(onForgetAll).not.toHaveBeenCalled();
    });

    it("shows Removing... and blocks a second delete while keys are being removed", () => {
      const { deleteButton } = renderSection("stored", true);

      expect(deleteButton.textContent).toContain("Removing...");
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
