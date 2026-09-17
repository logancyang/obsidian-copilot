import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import type { TurnFileChange } from "@/agentMode/session/types";

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

function renderCard(changes: TurnFileChange[], onOpen = jest.fn()) {
  const result = render(<FilesChangedCard changes={changes} onOpen={onOpen} />);
  return { ...result, onOpen };
}

/** Row labels as the user reads them, top to bottom. */
function rowNames(): string[] {
  return screen.getAllByRole("button").map((row) => row.getAttribute("title") ?? "");
}

describe("FilesChangedCard", () => {
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

  it("orders rows by vault path rather than by the order the agent touched them", () => {
    renderCard([change("notes/zeta.md"), change("alpha.md"), change("notes/beta.md")]);

    expect(rowNames()).toEqual(["alpha.md", "notes/beta.md", "notes/zeta.md"]);
  });

  it("shows the basename with its parent folder underneath, and the folder only when the file is not at the vault root", () => {
    renderCard([change("projects/Alpha/Project brief.md"), change("README.md")]);

    const nested = screen.getByRole("button", { name: /Project brief\.md/ });
    expect(within(nested).getByText("Project brief.md")).toBeTruthy();
    expect(within(nested).getByText("projects/Alpha")).toBeTruthy();

    const root = screen.getByRole("button", { name: /README\.md/ });
    expect(root.textContent).not.toContain("/");
  });

  it("badges a created file as new and a deleted file as deleted, and leaves a modified file unbadged", () => {
    renderCard([
      change("created.md", { status: "created", before: null }),
      change("deleted.md", { status: "deleted", after: null }),
      change("modified.md"),
    ]);

    expect(
      within(screen.getByRole("button", { name: /created\.md/ })).getByText("new")
    ).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: /deleted\.md/ })).getByText("deleted")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /modified\.md/ }).textContent).not.toMatch(
      /new|deleted/
    );
  });

  it("renders a zero count on each side so the count columns line up across rows", () => {
    renderCard([change("only-additions.md", { additions: 4, deletions: 0 })]);

    const row = screen.getByRole("button", { name: /only-additions\.md/ });
    expect(within(row).getByText("+4")).toBeTruthy();
    expect(within(row).getByText("−0")).toBeTruthy();
  });

  it("exposes the full vault path as each row's tooltip", () => {
    renderCard([change("projects/Alpha/Project brief.md")]);

    expect(screen.getByRole("button", { name: /Project brief\.md/ }).getAttribute("title")).toBe(
      "projects/Alpha/Project brief.md"
    );
  });

  it("hands the clicked change to onOpen", () => {
    const target = change("notes/beta.md", { additions: 3, deletions: 1 });
    const { onOpen } = renderCard([change("notes/alpha.md"), target]);

    fireEvent.click(screen.getByRole("button", { name: /beta\.md/ }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  it("keeps its height fixed and scrolls the rows when the turn changed more than five files", () => {
    renderCard(Array.from({ length: 10 }, (_, i) => change(`notes/file-${i}.md`)));

    const list = screen.getByRole("list");
    expect(list.classList.contains("tw-max-h-44")).toBe(true);
    expect(list.classList.contains("tw-overflow-y-auto")).toBe(true);
    expect(screen.getAllByRole("button")).toHaveLength(10);
  });
});
