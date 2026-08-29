import {
  ReleaseNotesDialogContent,
  type ReleaseNotes,
  type ReleaseNotesDialogState,
} from "@/components/release-update/ReleaseNotesDialog";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const RELEASE_BODY =
  "# v4.0.4 - A chime when your agent is ready\n\n![Notification settings](https://github.com/user-attachments/assets/example)\n\n(https://github.com/logancyang/obsidian-copilot/pull/2988)";
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
        READY_STATE.release.htmlUrl
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
  });
});
