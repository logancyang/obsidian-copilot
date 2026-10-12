jest.mock(
  "@/search/searchUtils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/search/searchUtils"),
    shouldIndexFile: jest.fn(() => true),
  })
);

import { shouldIndexFile } from "@/search/searchUtils";
import type { App } from "obsidian";
import { countProjectMarkdownFiles, listProjectDocumentFiles } from "./projectDocumentFiles";

const indexFile = shouldIndexFile as jest.Mock;

function appWith(paths: string[]): App {
  const files = paths.map((path) => ({
    path,
    extension: path.split(".").pop()!,
  }));
  return { vault: { getFiles: () => files } } as unknown as App;
}

const INCLUDE_PROJ = { inclusions: "Proj" };

beforeEach(() => {
  indexFile.mockReset();
  indexFile.mockReturnValue(true);
});

describe("projectDocumentFiles", () => {
  describe("listProjectDocumentFiles()", () => {
    it("returns PDF, Office, EPUB and image files sorted by path and leaves out markdown and other text", () => {
      const app = appWith([
        "Proj/z.png",
        "Proj/note.md",
        "Proj/b.DOCX",
        "Proj/a.pdf",
        "Proj/book.epub",
        "Proj/data.csv",
      ]);

      const files = listProjectDocumentFiles(app, INCLUDE_PROJ);

      expect(files.map((f) => f.path)).toEqual([
        "Proj/a.pdf",
        "Proj/b.DOCX",
        "Proj/book.epub",
        "Proj/z.png",
      ]);
    });

    it("leaves out files the project's patterns do not include", () => {
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path !== "Proj/secret.pdf"); // prettier-ignore
      const app = appWith(["Proj/a.pdf", "Proj/secret.pdf"]);

      expect(listProjectDocumentFiles(app, { inclusions: "Proj", exclusions: "Proj/secret.pdf" }).map((f) => f.path)).toEqual(["Proj/a.pdf"]); // prettier-ignore
    });

    it("returns the same empty list for every call when the project has no inclusions", () => {
      const app = appWith(["Proj/a.pdf"]);

      const first = listProjectDocumentFiles(app, {});
      expect(first).toEqual([]);
      expect(listProjectDocumentFiles(app, undefined)).toBe(first);
    });
  });

  describe("countProjectMarkdownFiles()", () => {
    it("counts only the included markdown files", () => {
      const app = appWith(["Proj/a.md", "Proj/b.MD", "Proj/c.pdf", "Proj/d.png"]);

      expect(countProjectMarkdownFiles(app, INCLUDE_PROJ)).toBe(2);
    });

    it("returns zero when the project has no inclusions", () => {
      expect(countProjectMarkdownFiles(appWith(["Proj/a.md"]), {})).toBe(0);
    });
  });
});
