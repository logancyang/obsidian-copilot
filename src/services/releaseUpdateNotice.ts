import { buttonVariants } from "@/components/ui/button";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { requestLatestRelease } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { isNewerVersion } from "@/utils";
import { App, Notice } from "obsidian";

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
        cls: cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          "tw-max-w-full tw-whitespace-normal"
        ),
      });
      button.addEventListener("click", () => {
        if (!active) return;
        notice?.hide();
        new ReleaseNotesModal(app, release, currentVersion).open();
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
