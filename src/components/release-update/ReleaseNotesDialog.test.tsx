import {
  ReleaseNotesDialogContent,
  ReleaseNotesModal,
  type ReleaseNotes,
  type ReleaseNotesDialogState,
} from "@/components/release-update/ReleaseNotesDialog";
import { ReactModal } from "@/components/modals/ReactModal";
import { requestReleaseNotesSince } from "@/components/release-update/releaseNotes";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));
jest.mock("@/components/release-update/releaseNotes", () => ({
  ...jest.requireActual<typeof import("@/components/release-update/releaseNotes")>(
    "@/components/release-update/releaseNotes"
  ),
  requestReleaseNotesSince: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const RELEASE_BODY =
  "# v4.0.4 - A chime when your agent is ready\n\n![Notification settings](https://github.com/user-attachments/assets/example)\n\n(https://github.com/logancyang/obsidian-copilot/pull/2988)";
const ISSUE_600_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/600";
const RELEASE_TITLE = "# v4.0.4 - A chime when your agent is ready";
const RELEASE = {
  version: "4.0.4",
  body: RELEASE_BODY,
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
} satisfies ReleaseNotes;
const OLDER_RELEASE = {
  version: "4.0.3",
  body: "# v4.0.3 - Earlier fixes",
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.3",
} satisfies ReleaseNotes;
const READY_STATE: ReleaseNotesDialogState = {
  status: "ready",
  releases: [RELEASE],
};

describe("ReleaseNotesDialog", () => {
  describe("ReleaseNotesModal", () => {
    describe("constructor()", () => {
      it(`prepares the loaded release in a full-bleed Obsidian modal for ${ISSUE_URL}`, () => {
        const modal = new ReleaseNotesModal(new App(), RELEASE, "4.0.2");

        expect(modal.modalEl.classList.contains("copilot-modal-full-bleed")).toBe(true);
      });
    });

    describe("onOpen()", () => {
      it(`renders the supplied latest release, then appends the releases skipped since the installed version for ${ISSUE_600_URL}`, async () => {
        const modal = new ReleaseNotesModal(new App(), RELEASE, "4.0.2");
        modal.contentEl.empty = () => modal.contentEl.replaceChildren();
        let resolveHistory!: (releases: ReleaseNotes[]) => void;
        jest.mocked(requestReleaseNotesSince).mockReturnValue(
          new Promise((resolve) => {
            resolveHistory = resolve;
          })
        );
        jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, el) => {
          el.textContent = markdown.split("\n")[0];
        });

        await act(async () => {
          ReactModal.prototype.onOpen.call(modal);
        });

        const content = within(modal.contentEl);
        expect(content.getByText("Copilot update available")).not.toBeNull();
        expect(content.getByText(RELEASE_TITLE)).not.toBeNull();
        expect(requestReleaseNotesSince).toHaveBeenCalledWith("4.0.2", RELEASE);

        await act(async () => {
          resolveHistory([RELEASE, OLDER_RELEASE]);
        });

        expect(content.getByText(OLDER_RELEASE.body)).not.toBeNull();
        await act(async () => {
          ReactModal.prototype.onClose.call(modal);
        });
      });
    });
  });

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
        const reference = el.doc.createElement("a");
        reference.href = "https://github.com/logancyang/obsidian-copilot/pull/2988";
        reference.textContent = reference.href;
        el.append(heading, image, reference);
      });

      const view = render(
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
      expect(screen.getByRole("link", { name: "#2988" }).getAttribute("href")).toBe(
        "https://github.com/logancyang/obsidian-copilot/pull/2988"
      );
      expect(
        screen.queryByText("Review what changed, then update this vault from Community Plugins.")
      ).toBeNull();
      expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(
        RELEASE.htmlUrl
      );
      const updateLink = screen.getByRole("link", { name: "Update in Obsidian" });
      expect(updateLink.getAttribute("href")).toBe("obsidian://show-plugin?id=copilot");

      updateLink.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(updateLink);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(renderMarkdown).toHaveBeenCalledWith(
        expect.anything(),
        RELEASE_BODY,
        expect.any(HTMLElement),
        "",
        expect.anything()
      );
      expect(view.container.firstElementChild?.classList.contains("tw-h-[min(80vh,46rem)]")).toBe(
        true
      );
      expect(
        view.container.firstElementChild?.classList.contains("tw-max-h-[calc(100vh-2rem)]")
      ).toBe(true);
      const notesPane = view.container.querySelector(".tw-overflow-y-auto");
      expect(notesPane?.classList.contains("tw-min-h-0")).toBe(true);
      expect(notesPane?.classList.contains("tw-flex-1")).toBe(true);
    });

    it(`separates each skipped release with a divider and links View on GitHub to the newest for ${ISSUE_600_URL}`, async () => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, markdown, el) => {
        el.textContent = markdown.split("\n")[0];
      });

      render(
        <AppContext.Provider value={new App()}>
          <ReleaseNotesDialogContent
            onClose={jest.fn()}
            state={{ status: "ready", releases: [RELEASE, OLDER_RELEASE] }}
          />
        </AppContext.Provider>
      );

      await waitFor(() => expect(screen.getByText(OLDER_RELEASE.body)).not.toBeNull());
      expect(screen.getByText(RELEASE_TITLE).classList.contains("copilot-divider-t")).toBe(false);
      expect(screen.getByText(OLDER_RELEASE.body).classList.contains("copilot-divider-t")).toBe(
        true
      );
      expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(
        RELEASE.htmlUrl
      );
    });
  });
});
