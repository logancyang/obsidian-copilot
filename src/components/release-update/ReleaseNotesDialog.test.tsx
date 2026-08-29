import {
  ReleaseNotesDialog,
  ReleaseNotesDialogContent,
  RELEASE_NOTES_MODAL_CLASS,
  ReleaseNotesModal,
  type ReleaseNotesDialogState,
} from "@/components/release-update/ReleaseNotesDialog";
import type { ReleaseNotes } from "@/components/release-update/releaseNotes";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const RELEASE_BODY =
  "# v4.0.4 - A chime when your agent is ready\n\n![Notification settings](https://github.com/user-attachments/assets/example)\n\n(https://github.com/logancyang/obsidian-copilot/pull/2988)";
const FORMATTED_RELEASE_BODY =
  "# v4.0.4 - A chime when your agent is ready\n\n![Notification settings](https://github.com/user-attachments/assets/example)\n\n([#2988](https://github.com/logancyang/obsidian-copilot/pull/2988))";
const RELEASE = {
  version: "4.0.4",
  body: RELEASE_BODY,
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
} satisfies ReleaseNotes;
const READY_STATE: ReleaseNotesDialogState = {
  status: "ready",
  release: RELEASE,
};

describe("ReleaseNotesDialog", () => {
  describe("ReleaseNotesDialogContent()", () => {
    it(`renders ready release Markdown and leads to both update destinations for ${ISSUE_URL}`, async () => {
      const onClose = jest.fn();
      jest.mocked(renderMarkdown).mockImplementation(async (_app, _markdown, el) => {
        expect(el.classList.contains("markdown-rendered")).toBe(true);
        const heading = el.doc.createElement("h1");
        heading.textContent = "v4.0.4 - A chime when your agent is ready";
        const image = el.doc.createElement("img");
        image.alt = "Notification settings";
        image.src = "https://github.com/user-attachments/assets/example";
        el.append(heading, image);
      });

      render(
        <AppContext.Provider value={new App()}>
          <ReleaseNotesDialogContent onClose={onClose} state={READY_STATE} />
        </AppContext.Provider>
      );

      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "v4.0.4 - A chime when your agent is ready" })
        ).not.toBeNull()
      );
      expect(screen.getByRole("img", { name: "Notification settings" })).not.toBeNull();
      expect(
        screen.queryByText("Review what changed, then update this vault from Community Plugins.")
      ).toBeNull();
      expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(
        READY_STATE.release.htmlUrl
      );
      const updateLink = screen.getByRole("link", { name: "Update in Obsidian" });
      expect(updateLink.getAttribute("href")).toBe("obsidian://show-plugin?id=copilot");

      updateLink.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(updateLink);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(renderMarkdown).toHaveBeenCalledWith(
        expect.anything(),
        FORMATTED_RELEASE_BODY,
        expect.any(HTMLElement),
        "",
        expect.anything()
      );
    });
  });

  describe("ReleaseNotesDialog()", () => {
    it(`shows a stable loading shell before replacing it with the fetched release for ${ISSUE_URL}`, async () => {
      let resolveRelease: ((release: ReleaseNotes) => void) | undefined;
      const loadReleaseNotes = jest.fn(
        () =>
          new Promise<ReleaseNotes>((resolve) => {
            resolveRelease = resolve;
          })
      );

      render(
        <AppContext.Provider value={new App()}>
          <ReleaseNotesDialog loadReleaseNotes={loadReleaseNotes} onClose={jest.fn()} />
        </AppContext.Provider>
      );

      expect(screen.getByText("Loading release notes…")).not.toBeNull();
      expect(loadReleaseNotes).toHaveBeenCalledTimes(1);

      await act(async () => resolveRelease?.(RELEASE));

      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "v4.0.4 - A chime when your agent is ready" })
        ).not.toBeNull()
      );
    });

    it(`keeps update and release-page actions available when release notes fail to load for ${ISSUE_URL}`, async () => {
      render(
        <AppContext.Provider value={new App()}>
          <ReleaseNotesDialog
            loadReleaseNotes={jest.fn().mockRejectedValue(new Error("offline"))}
            onClose={jest.fn()}
          />
        </AppContext.Provider>
      );

      expect(
        await screen.findByRole("alert", { name: "Couldn’t load release notes" })
      ).not.toBeNull();
      expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(
        "https://github.com/logancyang/obsidian-copilot/releases/latest"
      );
      expect(screen.getByRole("link", { name: "Update in Obsidian" })).not.toBeNull();
    });
  });

  describe("ReleaseNotesModal", () => {
    describe("constructor()", () => {
      it(`uses the full-bleed release frame without duplicating the dialog title for ${ISSUE_URL}`, () => {
        const modal = new ReleaseNotesModal(new App());

        expect(modal.modalEl.classList.contains(RELEASE_NOTES_MODAL_CLASS)).toBe(true);
        expect(modal.modalEl.className).toBe(`modal ${RELEASE_NOTES_MODAL_CLASS}`);
        expect(modal.titleEl.textContent).toBe("");
      });
    });
  });
});
