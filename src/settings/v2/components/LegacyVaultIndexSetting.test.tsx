import {
  confirmLegacyVaultIndexToggle,
  LegacyVaultIndexSetting,
} from "@/settings/v2/components/LegacyVaultIndexSetting";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const updateSetting = jest.fn<void, unknown[]>();
jest.mock("@/settings/model", () => ({
  updateSetting: (...args: unknown[]) => updateSetting(...args),
}));

// Captures the modal's constructor arguments so the tests can assert what was
// requested and then run the confirmation the user would have clicked.
const modalCalls: { onConfirm: () => void | Promise<void>; enabling: boolean }[] = [];
const open = jest.fn();
jest.mock("@/components/modals/SemanticSearchToggleModal", () => ({
  SemanticSearchToggleModal: class {
    constructor(_app: App, onConfirm: () => void | Promise<void>, enabling: boolean) {
      modalCalls.push({ onConfirm, enabling });
    }
    open = open;
  },
}));

const app = {} as App;

/** Run the confirmation callback of the most recently opened modal. */
async function confirmLastModal(): Promise<void> {
  await modalCalls[modalCalls.length - 1].onConfirm();
}

describe("LegacyVaultIndexSetting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modalCalls.length = 0;
  });

  describe("LegacyVaultIndexSetting()", () => {
    it("reports the current state through the switch", () => {
      render(<LegacyVaultIndexSetting enabled miyoManaged={false} onToggle={jest.fn()} />);

      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    });

    it("asks for the opposite of the current state when toggled", () => {
      const onToggle = jest.fn();
      render(<LegacyVaultIndexSetting enabled miyoManaged={false} onToggle={onToggle} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onToggle).toHaveBeenCalledWith(false);
    });

    it("refuses changes and points at the Miyo tab while Miyo owns the setting, so the restored switch cannot strand Miyo retrieval on an index backend that can no longer refresh (https://github.com/logancyang/obsidian-copilot-preview/issues/319)", () => {
      const onToggle = jest.fn();
      render(<LegacyVaultIndexSetting enabled miyoManaged onToggle={onToggle} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onToggle).not.toHaveBeenCalled();
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByText(/Disconnect from the Miyo tab/)).toBeTruthy();
    });
  });

  describe("confirmLegacyVaultIndexToggle()", () => {
    it("leaves the setting untouched until the user confirms", () => {
      confirmLegacyVaultIndexToggle(app, false);

      expect(open).toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("writes the requested state on confirmation", async () => {
      confirmLegacyVaultIndexToggle(app, true);
      await confirmLastModal();

      expect(modalCalls[0].enabling).toBe(true);
      expect(updateSetting).toHaveBeenCalledWith("enableSemanticSearchV3", true);
    });

    it("clears the setting on confirmation when disabling", async () => {
      confirmLegacyVaultIndexToggle(app, false);
      await confirmLastModal();

      expect(modalCalls[0].enabling).toBe(false);
      expect(updateSetting).toHaveBeenCalledWith("enableSemanticSearchV3", false);
    });
  });
});
