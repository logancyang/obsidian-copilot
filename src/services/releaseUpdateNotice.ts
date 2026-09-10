import { buttonVariants } from "@/components/ui/button";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { requestLatestRelease } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { isNewerVersion } from "@/utils";
import { App, Notice } from "obsidian";

/**
 * Starts a background update check and returns synchronous plugin-unload cleanup.
 * @param app - Obsidian app that owns the notice and release notes dialog.
 * @param currentVersion - Installed plugin version to compare with the released manifest.
 * @param lastShownVersion - Release already announced at startup, independent of banner dismissal.
 * @param onShown - Persists the release version after its notice is displayed.
 */
export function startReleaseUpdateCheck(
  app: App,
  currentVersion: string,
  lastShownVersion: string | null,
  onShown: (version: string) => void
): () => void {
  let active = true;
  let notice: Notice | undefined;
  void requestLatestRelease()
    .then((release) => {
      // requestUrl cannot be cancelled; an unloaded plugin must not show late UI.
      if (
        !active ||
        !release ||
        release.version === lastShownVersion ||
        !isNewerVersion(release.version, currentVersion)
      )
        return;
      const fragment = app.workspace.containerEl.doc.win.createFragment();
      const content = fragment.createDiv({ cls: "copilot-release-notice" });
      content.createDiv({ text: `Copilot ${release.version} is available` });
      const button = content.createEl("button", {
        text: "View release notes",
        cls: cn(buttonVariants({ variant: "secondary" }), "tw-max-w-full tw-whitespace-normal"),
      });
      button.addEventListener("click", () => {
        if (!active) return;
        notice?.hide();
        new ReleaseNotesModal(app, release).open();
      });
      notice = new Notice(fragment, 15000);
      onShown(release.version);
    })
    .catch((error) => logWarn("Copilot update check failed", error));
  return () => {
    active = false;
    notice?.hide();
  };
}
