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
  hasUpdate = false,
}: { available?: boolean; previewEnabled?: boolean; hasUpdate?: boolean } = {}) {
  jest.mocked(useIsPreviewAvailable).mockReturnValue(available);
  jest.mocked(useSettingsValue).mockReturnValue({
    previewEnabled,
  } as ReturnType<typeof useSettingsValue>);
  return render(<PreviewSwitch currentVersion="4.0.13" hasUpdate={hasUpdate} />);
}

describe("PreviewSwitch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("PreviewSwitch()", () => {
    it("labels Preview with the installed release and links to that release's notes", () => {
      renderSwitch();

      expect(screen.getByRole("radio", { name: "Official" }).getAttribute("aria-checked")).toBe(
        "true"
      );
      expect(
        screen.getByRole("radio", { name: "Preview · 4.0.13" }).getAttribute("aria-checked")
      ).toBe("false");
      expect(
        screen.getByRole("link", { name: "See what is in this preview" }).getAttribute("href")
      ).toBe("https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.13");
    });

    it("turns Preview on and confirms the switch", () => {
      renderSwitch();

      fireEvent.click(screen.getByRole("radio", { name: "Preview · 4.0.13" }));

      expect(updateSetting).toHaveBeenCalledWith("previewEnabled", true);
      expect(Notice).toHaveBeenCalledWith("Copilot Preview is on.");
    });

    it("switches back to Official and confirms the switch", () => {
      renderSwitch({ previewEnabled: true });

      fireEvent.click(screen.getByRole("radio", { name: "Official" }));

      expect(updateSetting).toHaveBeenCalledWith("previewEnabled", false);
      expect(Notice).toHaveBeenCalledWith("Copilot is back on Official.");
    });

    it("prompts an update to the community store when a newer release exists", () => {
      renderSwitch({ hasUpdate: true });

      expect(
        screen.getByRole("link", { name: "Update to get the latest preview" }).getAttribute("href")
      ).toBe("obsidian://show-plugin?id=copilot");
    });

    it("omits the update prompt when the installed release is the latest", () => {
      renderSwitch();

      expect(screen.queryByRole("link", { name: "Update to get the latest preview" })).toBeNull();
    });

    it("renders nothing when the verified token does not carry preview", () => {
      const { container } = renderSwitch({ available: false, previewEnabled: true });

      expect(container.innerHTML).toBe("");
    });
  });
});
