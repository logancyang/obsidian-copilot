import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import type { TurnFileChange } from "@/agentMode/session/types";
import { useApp } from "@/context";
import { Notice, TFile, type App } from "obsidian";

jest.mock("@/context", () => ({ useApp: jest.fn() }));

const ISSUE_919 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/919";

function fakeApp(paths: string[] = []): App {
  const files = paths.map((path) => Object.assign(new TFile(), { path }));
  return {
    workspace: {
      iterateAllLeaves: jest.fn(),
      getLeaf: jest.fn(() => ({ openFile: jest.fn().mockResolvedValue(undefined) })),
    },
    vault: {
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
  } as unknown as App;
}

function change(path: string, overrides: Partial<TurnFileChange> = {}): TurnFileChange {
  return {
    path,
    status: "modified",
    before: "before",
    after: "after",
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

function renderCard(changes: TurnFileChange[], app = fakeApp(), onOpen = jest.fn()) {
  jest.mocked(useApp).mockReturnValue(app);
  const result = render(<FilesChangedCard changes={changes} onOpen={onOpen} />);
  return { ...result, onOpen, app };
}

function row(name: RegExp): HTMLElement {
  return screen.getByText(name).closest("li")!;
}

function rowNames(): string[] {
  return screen.getAllByRole("button").map((row) => row.getAttribute("title") ?? "");
}

describe("FilesChangedCard", () => {
  describe("FilesChangedCard()", () => {
    it("titles the card with the file count and the summed additions and deletions", () => {
      renderCard([
        change("notes/a.md", { additions: 30, deletions: 2 }),
        change("notes/b.md", { additions: 12, deletions: 0 }),
        change("c.md", { additions: 0, deletions: 5 }),
      ]);

      const header = screen.getByText("Files changed (3)").parentElement!;
      expect(within(header).getByText("+42")).toBeTruthy();
      expect(within(header).getByText("−7")).toBeTruthy();
    });

    it("collapses to one unheaded row when the turn changed a single file, keeping its name, folder, badge and counts https://github.com/Brevilabs/obsidian-copilot-private/issues/348", () => {
      renderCard([
        change("projects/Alpha/Project brief.md", {
          status: "created",
          before: null,
          additions: 30,
          deletions: 0,
        }),
      ]);

      expect(screen.queryByText(/Files changed/)).toBeNull();
      const rows = screen.getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Project brief.md")).toBeTruthy();
      expect(within(rows[0]).getByText("projects/Alpha")).toBeTruthy();
      expect(within(rows[0]).getByText("new")).toBeTruthy();
      expect(within(rows[0]).getByText("+30")).toBeTruthy();
      expect(within(rows[0]).getByText("−0")).toBeTruthy();
    });

    it("orders rows by vault path rather than by the order the agent touched them", () => {
      renderCard([change("notes/zeta.md"), change("alpha.md"), change("notes/beta.md")]);

      expect(rowNames()).toEqual(["alpha.md", "notes/beta.md", "notes/zeta.md"]);
    });

    it("shows the basename with its parent folder underneath, and the folder only when the file is not at the vault root", () => {
      renderCard([change("projects/Alpha/Project brief.md"), change("README.md")]);

      const nested = row(/Project brief\.md/);
      expect(within(nested).getByText("Project brief.md")).toBeTruthy();
      expect(within(nested).getByText("projects/Alpha")).toBeTruthy();

      const root = row(/README\.md/);
      expect(root.textContent).not.toContain("/");
    });

    it("badges a created file as new and a deleted file as deleted, and leaves a modified file unbadged", () => {
      renderCard([
        change("created.md", { status: "created", before: null }),
        change("deleted.md", { status: "deleted", after: null }),
        change("modified.md"),
      ]);

      expect(within(row(/created\.md/)).getByText("new")).toBeTruthy();
      expect(within(row(/deleted\.md/)).getByText("deleted")).toBeTruthy();
      expect(row(/modified\.md/).textContent).not.toMatch(/new|deleted/);
    });

    it("opens the diff of the row that was chosen outside its file name", () => {
      const target = change("notes/beta.md", { additions: 3, deletions: 1 });
      const { onOpen, app } = renderCard([change("notes/alpha.md"), target]);

      fireEvent.click(screen.getByRole("button", { name: /beta\.md/ }));

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(target);
      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it(`opens the note itself, skipping the diff, when its file name is chosen ${ISSUE_919}`, () => {
      const { onOpen, app } = renderCard(
        [change("notes/alpha.md"), change("notes/beta.md")],
        fakeApp(["notes/alpha.md", "notes/beta.md"])
      );

      fireEvent.click(screen.getByRole("link", { name: "beta.md" }));

      expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      const leaf = jest.mocked(app.workspace.getLeaf).mock.results[0].value;
      expect(leaf.openFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: "notes/beta.md" })
      );
      expect(onOpen).not.toHaveBeenCalled();
    });

    it(`says the note is gone instead of creating an empty one when it moved after the turn ${ISSUE_919}`, () => {
      const { app } = renderCard([change("notes/beta.md")]);

      fireEvent.click(screen.getByRole("link", { name: "beta.md" }));

      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("notes/beta.md no longer exists.");
    });

    it(`offers a deleted file's diff only, with its name as plain text ${ISSUE_919}`, () => {
      const target = change("deleted.md", { status: "deleted", after: null });
      const { onOpen } = renderCard([target]);

      expect(screen.queryByRole("link")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "deleted.md" }));

      expect(onOpen).toHaveBeenCalledWith(target);
    });
  });
});
