import { mockTFile } from "@/__tests__/mockObsidian";
import { StructuredTool } from "@langchain/core/tools";
import type { App, TFile } from "obsidian";
import { createReadNoteTool } from "./NoteTools";

type ReadNoteResult = {
  notePath: string;
  status?: string;
  message?: string;
  noteTitle?: string;
  heading?: string;
  chunkId?: string;
  chunkIndex?: number;
  totalChunks?: number;
  hasMore?: boolean;
  nextChunkIndex?: number | null;
  content?: string;
  mtime?: number;
  linkedNotes?: Array<{
    linkText: string;
    displayText: string;
    section: string | undefined;
    candidates: Array<{ path: string; title: string }>;
  }>;
  candidates?: Array<{ path: string; title: string }>;
};

const makeFile = (path: string): TFile => {
  const fileName = path.split("/").pop() || path;
  return mockTFile({
    path,
    basename: fileName.replace(/\.[^/.]+$/, ""),
    stat: { mtime: Date.now(), ctime: Date.now(), size: 0 },
  });
};

const numberedLines = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `Line ${i + 1}`);

describe("NoteTools", () => {
  describe("createReadNoteTool()", () => {
    let readNoteTool: StructuredTool;
    let getAbstractFileByPathMock: jest.Mock;
    let getMarkdownFilesMock: jest.Mock;
    let getFirstLinkpathDestMock: jest.Mock;
    let mockRead: jest.Mock;

    const invokeReadNoteTool = async (args: {
      notePath: string;
      chunkIndex?: number | string;
    }): Promise<ReadNoteResult> => {
      const result: unknown = await readNoteTool.invoke(args);
      return (typeof result === "string" ? JSON.parse(result) : result) as ReadNoteResult;
    };

    beforeEach(() => {
      getAbstractFileByPathMock = jest.fn().mockReturnValue(null);
      getMarkdownFilesMock = jest.fn().mockReturnValue([]);
      getFirstLinkpathDestMock = jest.fn().mockReturnValue(null);
      mockRead = jest.fn().mockResolvedValue("");

      const app = {
        vault: {
          getAbstractFileByPath: getAbstractFileByPathMock,
          getMarkdownFiles: getMarkdownFilesMock,
          read: mockRead,
        },
        metadataCache: {
          getFileCache: jest.fn(),
          getFirstLinkpathDest: getFirstLinkpathDestMock,
        },
      } as unknown as App;

      readNoteTool = createReadNoteTool(app);
    });

    it("returns a single-chunk note's full content with no further chunks", async () => {
      const notePath = "Notes/test.md";
      getAbstractFileByPathMock.mockReturnValue(makeFile(notePath));
      mockRead.mockResolvedValue(["## Heading", "Line 1", "Line 2"].join("\n"));

      const result = await invokeReadNoteTool({ notePath });

      expect(result.notePath).toBe(notePath);
      expect(result.totalChunks).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.content).toBe(["## Heading", "Line 1", "Line 2"].join("\n"));
    });

    it("returns the requested chunk of a multi-chunk note", async () => {
      const notePath = "Notes/multi.md";
      getAbstractFileByPathMock.mockReturnValue(makeFile(notePath));
      const lines = numberedLines(210);
      mockRead.mockResolvedValue(lines.join("\n"));

      const result = await invokeReadNoteTool({ notePath, chunkIndex: 1 });

      expect(result.chunkIndex).toBe(1);
      expect(result.content).toBe(lines.slice(200).join("\n"));
    });

    it("accepts chunkIndex provided as a numeric string", async () => {
      const notePath = "Notes/string-index.md";
      getAbstractFileByPathMock.mockReturnValue(makeFile(notePath));
      const lines = numberedLines(205);
      mockRead.mockResolvedValue(lines.join("\n"));

      const result = await invokeReadNoteTool({ notePath, chunkIndex: "1" });

      expect(result.chunkIndex).toBe(1);
      expect(result.content).toBe(lines.slice(200).join("\n"));
    });

    it("resolves a note path given without its extension to the .md file", async () => {
      const rawPath = "Notes/extensionless";
      const file = makeFile(`${rawPath}.md`);
      getAbstractFileByPathMock.mockImplementation((path: string) =>
        path === `${rawPath}.md` ? file : null
      );
      mockRead.mockResolvedValue("Content");

      const result = await invokeReadNoteTool({ notePath: rawPath });

      expect(result.notePath).toBe(file.path);
      expect(result.chunkIndex).toBe(0);
      expect(mockRead).toHaveBeenCalledWith(file);
    });

    it("resolves a bare note name through Obsidian link resolution without an active note", async () => {
      const requestedPath = "Project Plan";
      const targetFile = makeFile("Projects/Project Plan.md");
      getFirstLinkpathDestMock.mockImplementation((link: string, source: string) =>
        link === requestedPath && source === "" ? targetFile : null
      );
      mockRead.mockResolvedValue("Content");

      const result = await invokeReadNoteTool({ notePath: requestedPath });

      expect(result.notePath).toBe(targetFile.path);
      expect(mockRead).toHaveBeenCalledWith(targetFile);
    });

    it("falls back to the only note with a matching basename when link resolution fails", async () => {
      const targetFile = makeFile("Area/Solo Note.md");
      getMarkdownFilesMock.mockReturnValue([targetFile]);
      mockRead.mockResolvedValue("Content");

      const result = await invokeReadNoteTool({ notePath: "Solo Note" });

      expect(result.notePath).toBe(targetFile.path);
      expect(mockRead).toHaveBeenCalledWith(targetFile);
    });

    it("matches a unique partial path even when other notes share the basename", async () => {
      const targetFile = makeFile("Projects/Project Plan.md");
      getMarkdownFilesMock.mockReturnValue([targetFile, makeFile("Archive/Project Plan.md")]);
      mockRead.mockResolvedValue("Content");

      const result = await invokeReadNoteTool({ notePath: "Projects/Project Plan" });

      expect(result.notePath).toBe(targetFile.path);
      expect(mockRead).toHaveBeenCalledWith(targetFile);
    });

    it("returns not_unique with every candidate when several notes share the title", async () => {
      const projectFile = makeFile("Projects/Project Plan.md");
      const archiveFile = makeFile("Archive/Project Plan.md");
      getMarkdownFilesMock.mockReturnValue([projectFile, archiveFile]);

      const result = await invokeReadNoteTool({ notePath: "Project Plan" });

      expect(result).toEqual({
        notePath: "Project Plan",
        status: "not_unique",
        message: 'Multiple notes match "Project Plan". Provide a more specific path.',
        candidates: [
          { path: projectFile.path, title: projectFile.basename },
          { path: archiveFile.path, title: archiveFile.basename },
        ],
      });
      expect(mockRead).not.toHaveBeenCalled();
    });

    it("returns not_found without reading when the note cannot be resolved", async () => {
      const result = await invokeReadNoteTool({ notePath: "Notes/missing.md" });

      expect(result).toEqual({
        notePath: "Notes/missing.md",
        status: "not_found",
        message: 'Note "Notes/missing.md" was not found or is not a readable file.',
      });
      expect(mockRead).not.toHaveBeenCalled();
    });

    it.each(["[[#Setup]]", "[[]]"])(
      "returns not_found for the wiki link %s that names no note",
      async (notePath) => {
        getMarkdownFilesMock.mockReturnValue([makeFile("Docs/Guide.md")]);

        const result = await invokeReadNoteTool({ notePath });

        expect(result).toEqual({
          notePath,
          status: "not_found",
          message: `Note "${notePath}" was not found or is not a readable file.`,
        });
        expect(mockRead).not.toHaveBeenCalled();
      }
    );

    it("returns invalid_path without touching the vault when notePath starts with a slash", async () => {
      const result = await invokeReadNoteTool({ notePath: "/Projects/note.md" });

      expect(result).toEqual({
        notePath: "/Projects/note.md",
        status: "invalid_path",
        message: "Provide the note path relative to the vault root without a leading slash.",
      });
      expect(getAbstractFileByPathMock).not.toHaveBeenCalled();
      expect(mockRead).not.toHaveBeenCalled();
    });

    it.each(["-1", "1.5", "abc"])(
      "returns invalid_chunk_index without content for the non-negative-integer violation %p",
      async (chunkIndex) => {
        const notePath = "Notes/bad-index.md";
        getAbstractFileByPathMock.mockReturnValue(makeFile(notePath));
        mockRead.mockResolvedValue(["Line 1", "Line 2"].join("\n"));

        const result = await invokeReadNoteTool({ notePath, chunkIndex });

        expect(result.status).toBe("invalid_chunk_index");
        expect(result.content).toBeUndefined();
      }
    );

    it("lists every candidate, including duplicate basenames, for a wiki link in the chunk", async () => {
      const file = makeFile("Notes/source.md");
      const candidatePrimary = makeFile("Projects/Project Plan.md");
      const candidateDuplicate = makeFile("Archive/Project Plan.md");
      getAbstractFileByPathMock.mockReturnValue(file);
      getMarkdownFilesMock.mockReturnValue([candidatePrimary, candidateDuplicate, file]);
      mockRead.mockResolvedValue("Intro [[Project Plan]] details");

      const result = await invokeReadNoteTool({ notePath: file.path });

      expect(result.linkedNotes).toEqual([
        {
          linkText: "Project Plan",
          displayText: "Project Plan",
          section: undefined,
          candidates: [
            { path: candidatePrimary.path, title: candidatePrimary.basename },
            { path: candidateDuplicate.path, title: candidateDuplicate.basename },
          ],
        },
      ]);
    });

    it("reports the alias as displayText and the heading as section for an aliased wiki link", async () => {
      const file = makeFile("Notes/source.md");
      const guideFile = makeFile("Docs/Guide.md");
      getAbstractFileByPathMock.mockReturnValue(file);
      getFirstLinkpathDestMock.mockImplementation((link: string) =>
        link === "Docs/Guide" ? guideFile : null
      );
      getMarkdownFilesMock.mockReturnValue([guideFile, file]);
      mockRead.mockResolvedValue("See [[Docs/Guide#Setup|Quick Start]] for steps.");

      const result = await invokeReadNoteTool({ notePath: file.path });

      expect(result.linkedNotes).toEqual([
        {
          linkText: "Docs/Guide",
          displayText: "Quick Start",
          section: "Setup",
          candidates: [{ path: guideFile.path, title: guideFile.basename }],
        },
      ]);
    });
  });
});
