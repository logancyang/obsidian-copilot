import { NewVersionBanner } from "@/components/chat-components/NewVersionBanner";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { AppContext } from "@/context";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { useSettingsValue } from "@/settings/model";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

const mockOpen = jest.fn();

jest.mock("@/components/release-update/ReleaseNotesDialog", () => ({
  ReleaseNotesModal: jest.fn().mockImplementation(() => ({ open: mockOpen })),
}));
jest.mock("@/hooks/useLatestVersion", () => ({
  useLatestVersion: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  updateSetting: jest.fn(),
  useSettingsValue: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const RELEASE = {
  body: "# Copilot 4.0.4",
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
  version: "4.0.4",
};

describe("NewVersionBanner", () => {
  describe("NewVersionBanner()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(useSettingsValue).mockReturnValue({
        lastDismissedVersion: null,
      } as ReturnType<typeof useSettingsValue>);
      jest.mocked(useLatestVersion).mockReturnValue({
        hasUpdate: true,
        latestRelease: RELEASE,
        latestVersion: RELEASE.version,
      });
    });

    it(`opens the shared release dialog from the Quick Chat version link for ${ISSUE_URL}`, () => {
      const app = new App();
      render(
        <AppContext.Provider value={app}>
          <NewVersionBanner currentVersion="4.0.3" />
        </AppContext.Provider>
      );

      fireEvent.click(screen.getByRole("button", { name: "View release notes for v4.0.4" }));

      expect(ReleaseNotesModal).toHaveBeenCalledWith(app, RELEASE);
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });

    it(`hides the Quick Chat update link until its release record is available for ${ISSUE_URL}`, () => {
      jest.mocked(useLatestVersion).mockReturnValue({
        hasUpdate: true,
        latestRelease: null,
        latestVersion: RELEASE.version,
      });

      const { container } = render(
        <AppContext.Provider value={new App()}>
          <NewVersionBanner currentVersion="4.0.3" />
        </AppContext.Provider>
      );

      expect(container.firstElementChild).toBeNull();
    });
  });
});
