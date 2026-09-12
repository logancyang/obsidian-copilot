import { startReleaseUpdateCheck } from "@/services/releaseUpdateNotice";
import { requestLatestRelease } from "@/hooks/useLatestVersion";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { isNewerVersion } from "@/utils";
import { logWarn } from "@/logger";
import { App, Notice } from "obsidian";

jest.mock("@/hooks/useLatestVersion", () => ({ requestLatestRelease: jest.fn() }));
jest.mock("@/components/release-update/ReleaseNotesDialog", () => ({
  ReleaseNotesModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
jest.mock("@/utils", () => ({
  isNewerVersion: jest.fn(() => true),
}));

const release = { version: "4.1.0", body: "New features", htmlUrl: "https://github.com/release" };
const app = { workspace: { containerEl: document.createElement("div") } } as unknown as App;
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("releaseUpdateNotice", () => {
  describe("startReleaseUpdateCheck()", () => {
    const onShown = jest.fn<void, [string]>();
    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(isNewerVersion).mockReturnValue(true);
      jest.mocked(requestLatestRelease).mockResolvedValue(release);
    });

    it("returns cleanup immediately and opens matching release notes from the notice CTA", async () => {
      const cleanup = startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      expect(typeof cleanup).toBe("function");
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
      await settle();
      const fragment = jest.mocked(Notice).mock.calls[0][0] as DocumentFragment;
      expect(fragment.textContent).toContain("Copilot 4.1.0 is available");
      fragment.querySelector("button")!.click();
      expect(ReleaseNotesModal).toHaveBeenCalledWith(app, release);
      const modal = jest.mocked(ReleaseNotesModal).mock.results[0].value as ReleaseNotesModal;
      expect(modal.open).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("suppresses a release already shown at startup", async () => {
      startReleaseUpdateCheck(app, "4.0.0", release.version, onShown);
      await settle();
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
    });

    it("shows a newer release after an earlier startup notice was recorded", async () => {
      const cleanup = startReleaseUpdateCheck(app, "4.0.0", "4.0.9", onShown);
      await settle();
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(onShown).toHaveBeenCalledTimes(1);
      expect(onShown).toHaveBeenCalledWith(release.version);
      cleanup();
    });

    it("records the startup version exactly once after showing the notice", async () => {
      const cleanup = startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      expect(onShown).not.toHaveBeenCalled();
      await settle();
      expect(onShown).toHaveBeenCalledTimes(1);
      expect(onShown).toHaveBeenCalledWith(release.version);
      expect(jest.mocked(Notice).mock.invocationCallOrder[0]).toBeLessThan(
        onShown.mock.invocationCallOrder[0]
      );
      const fragment = jest.mocked(Notice).mock.calls[0][0] as DocumentFragment;
      fragment.querySelector("button")!.click();
      cleanup();
      expect(onShown).toHaveBeenCalledTimes(1);
    });

    it.each(["4.1.0", "4.2.0"])("does not notify an installed version of %s", async (version) => {
      jest.mocked(isNewerVersion).mockReturnValue(false);
      startReleaseUpdateCheck(app, version, null, onShown);
      await settle();
      expect(isNewerVersion).toHaveBeenCalledWith(release.version, version);
      await settle();
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
    });

    it("suppresses a response arriving after unload without waiting for the request", async () => {
      let resolve!: (value: typeof release) => void;
      jest.mocked(requestLatestRelease).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );
      const cleanup = startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      expect(cleanup()).toBeUndefined();
      resolve(release);
      await settle();
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
    });

    it("hides an existing notice and disables its CTA on unload", async () => {
      const cleanup = startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      await settle();
      const fragment = jest.mocked(Notice).mock.calls[0][0] as DocumentFragment;
      cleanup();
      expect(jest.mocked(Notice).mock.instances[0].hide).toHaveBeenCalledTimes(1);
      fragment.querySelector("button")!.click();
      expect(ReleaseNotesModal).not.toHaveBeenCalled();
    });

    it("does not notify when the version request fails", async () => {
      jest.mocked(requestLatestRelease).mockResolvedValue(null);
      startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      await settle();
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
    });

    it("handles an unexpected rejection without an unhandled promise", async () => {
      jest.mocked(requestLatestRelease).mockRejectedValue(new Error("offline"));
      startReleaseUpdateCheck(app, "4.0.0", null, onShown);
      await settle();
      expect(logWarn).toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
      expect(onShown).not.toHaveBeenCalled();
    });
  });
});
