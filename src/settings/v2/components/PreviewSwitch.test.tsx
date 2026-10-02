import { useIsPreviewAvailable } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PreviewSwitch } from "@/settings/v2/components/PreviewSwitch";
import { fireEvent, render, screen } from "@testing-library/react";
import { Notice } from "obsidian";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useIsPreviewAvailable: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  updateSetting: jest.fn(),
  useSettingsValue: jest.fn(),
}));

function renderSwitch({
  available = true,
  previewEnabled = false,
  currentVersion = "4.0.13",
  latestVersion = "4.0.13",
}: {
  available?: boolean;
  previewEnabled?: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
} = {}) {
  jest.mocked(useIsPreviewAvailable).mockReturnValue(available);
  jest.mocked(useSettingsValue).mockReturnValue({
    previewEnabled,
  } as ReturnType<typeof useSettingsValue>);
  return render(<PreviewSwitch currentVersion={currentVersion} latestVersion={latestVersion} />);
}

describe("PreviewSwitch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("PreviewSwitch()", () => {
    it("offers Official and Preview with the saved choice selected", () => {
      renderSwitch({ previewEnabled: true });

      expect(screen.getByRole("radio", { name: "Official" }).getAttribute("aria-checked")).toBe(
        "false"
      );
      expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe(
        "true"
      );
    });

    it("turns Preview on and confirms the switch", () => {
      renderSwitch();

      fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

      expect(updateSetting).toHaveBeenCalledWith("previewEnabled", true);
      expect(Notice).toHaveBeenCalledWith("Copilot Preview is on.");
    });

    it("switches back to Official and confirms the switch", () => {
      renderSwitch({ previewEnabled: true });

      fireEvent.click(screen.getByRole("radio", { name: "Official" }));

      expect(updateSetting).toHaveBeenCalledWith("previewEnabled", false);
      expect(Notice).toHaveBeenCalledWith("Copilot is back on Official.");
    });

    it("shows the preview version when the installed release is newer than the latest official (https://github.com/Brevilabs/obsidian-copilot-private/issues/626)", () => {
      renderSwitch({ currentVersion: "4.0.14", latestVersion: "4.0.13" });

      expect(screen.getByRole("radio", { name: "Preview · v4.0.14" })).toBeTruthy();
    });

    it.each([
      ["equals", "4.0.13"],
      ["is older than", "4.0.14"],
    ])(
      "hides the preview version when the installed release %s the latest official",
      (_relation, latestVersion) => {
        renderSwitch({ currentVersion: "4.0.13", latestVersion });

        expect(screen.getByRole("radio", { name: "Preview" })).toBeTruthy();
      }
    );

    it("hides the preview version until the latest official release is known", () => {
      renderSwitch({ currentVersion: "4.0.14", latestVersion: null });

      expect(screen.getByRole("radio", { name: "Preview" })).toBeTruthy();
    });

    it("renders nothing when the verified token does not carry preview", () => {
      const { container } = renderSwitch({ available: false, previewEnabled: true });

      expect(container.innerHTML).toBe("");
    });
  });
});
