import { AgentHomeReleaseUpdate } from "@/components/release-update/AgentHomeReleaseUpdate";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { AppContext } from "@/context";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { updateSetting, useSettingsValue } from "@/settings/model";
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
const VIDEO_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/603";
const RELEASE = {
  body: "# Copilot 4.0.4",
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
  version: "4.0.4",
};

function renderUpdate(visible = true) {
  return render(
    <AppContext.Provider value={new App()}>
      <AgentHomeReleaseUpdate currentVersion="4.0.3" visible={visible} />
    </AppContext.Provider>
  );
}

describe("AgentHomeReleaseUpdate", () => {
  describe("AgentHomeReleaseUpdate()", () => {
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

    it(`shows a newer release only on the global empty Agent Home for ${ISSUE_URL}`, () => {
      const { rerender } = renderUpdate(false);

      expect(screen.queryByRole("status")).toBeNull();

      rerender(
        <AppContext.Provider value={new App()}>
          <AgentHomeReleaseUpdate currentVersion="4.0.3" visible />
        </AppContext.Provider>
      );
      expect(screen.getByRole("status").getAttribute("data-agent-home-release-update")).toBe(
        "bottom-banner"
      );
    });

    it(`does not revive a release dismissed from Agent Home for ${ISSUE_URL}`, () => {
      jest.mocked(useSettingsValue).mockReturnValue({
        lastDismissedVersion: RELEASE.version,
      } as ReturnType<typeof useSettingsValue>);

      renderUpdate();

      expect(screen.queryByRole("status")).toBeNull();
    });

    it(`opens the matching release and persists dismissal from Agent Home for ${ISSUE_URL}`, () => {
      const app = new App();
      render(
        <AppContext.Provider value={app}>
          <AgentHomeReleaseUpdate currentVersion="4.0.3" visible />
        </AppContext.Provider>
      );

      fireEvent.click(screen.getByRole("button", { name: "See what’s new" }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss release update" }));

      expect(ReleaseNotesModal).toHaveBeenCalledWith(app, RELEASE, "4.0.3");
      expect(mockOpen).toHaveBeenCalledTimes(1);
      expect(updateSetting).toHaveBeenCalledWith("lastDismissedVersion", RELEASE.version);
    });

    it(`shows the latest release's demo video thumbnail in the banner for ${VIDEO_ISSUE_URL}`, () => {
      jest.mocked(useLatestVersion).mockReturnValue({
        hasUpdate: true,
        latestRelease: {
          ...RELEASE,
          body: "# Copilot 4.0.12\n\n[![Demo video: OpenCode 2](https://github.com/user-attachments/assets/thumb)](https://www.youtube.com/shorts/IjjXVFNFO0k)",
        },
        latestVersion: RELEASE.version,
      });

      renderUpdate();

      expect(
        screen.getByRole("link", { name: "Watch demo video: OpenCode 2" }).getAttribute("href")
      ).toBe("https://www.youtube.com/shorts/IjjXVFNFO0k");
    });
  });
});
