import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { requestLatestRelease } from "@/hooks/useLatestVersion";
import { logWarn } from "@/logger";
import { isNewerVersion } from "@/utils";
import { App, Notice } from "obsidian";

/**
 * Starts a background update check and returns synchronous plugin-unload cleanup.
 * @param app - Obsidian app that owns the notice and release notes dialog.
 * @param currentVersion - Installed plugin version to compare with the released manifest.
 */
export function startReleaseUpdateCheck(app: App, currentVersion: string): () => void {
  let active = true;
  let notice: Notice | undefined;
  void requestLatestRelease()
    .then((release) => {
      // requestUrl cannot be cancelled; an unloaded plugin must not show late UI.
      if (!active || !release || !isNewerVersion(release.version, currentVersion)) return;
      const fragment = app.workspace.containerEl.doc.win.createFragment();
      fragment.createDiv({ text: `Copilot ${release.version} is available.` });
      const button = fragment.createEl("button", { text: "View release notes" });
      button.addEventListener("click", () => {
        if (!active) return;
        notice?.hide();
        new ReleaseNotesModal(app, release).open();
      });
      notice = new Notice(fragment, 15000);
    })
    .catch((error) => logWarn("Copilot update check failed", error));
  return () => {
    active = false;
    notice?.hide();
  };
}
