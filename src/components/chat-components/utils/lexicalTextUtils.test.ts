import { parseTextForPills } from "./lexicalTextUtils";
import { App, TFile } from "obsidian";
import { mockTFolder } from "@/__tests__/mockObsidian";

const MockTFile = TFile as unknown as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("../constants/tools", () => ({
  AVAILABLE_TOOLS: ["@vault", "@websearch", "@composer"],
}));

const mockApp = {
  workspace: {
    getActiveFile: jest.fn(),
  },
  vault: {
    getMarkdownFiles: jest.fn(),
    getAllLoadedFiles: jest.fn(),
  },
  metadataCache: {
    getFirstLinkpathDest: jest.fn(),
    getFileCache: jest.fn(),
  },
};
const app = mockApp as unknown as App;

const text = (content: string) => ({ type: "text", content });

describe("lexicalTextUtils", () => {
  describe("parseTextForPills()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      MockTFile.mockImplementation(function (this: Record<string, unknown>) {
        this.basename = "Valid Note";
        this.path = "Valid Note.md";
      });
      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((noteName: string) =>
        noteName === "Valid Note" || noteName === "Valid Note.md" ? new TFile() : null
      );
      mockApp.workspace.getActiveFile.mockReturnValue(null);
      mockApp.vault.getAllLoadedFiles.mockReturnValue([
        mockTFolder({ path: "Projects", name: "Projects" }),
        mockTFolder({ path: "folder with spaces", name: "folder with spaces" }),
      ]);
    });

    it("turns a note reference into a note pill between its surrounding text", () => {
      expect(
        parseTextForPills(app, "Check out [[Valid Note]] for more info", { includeNotes: true })
      ).toEqual([
        text("Check out "),
        {
          type: "note-pill",
          content: "Valid Note",
          file: expect.any(TFile) as unknown,
          isActive: false,
        },
        text(" for more info"),
      ]);
    });

    it("turns a URL into a URL pill between its surrounding text", () => {
      expect(
        parseTextForPills(app, "Visit https://example.com for details", { includeURLs: true })
      ).toEqual([
        text("Visit "),
        { type: "url-pill", content: "https://example.com", url: "https://example.com" },
        text(" for details"),
      ]);
    });

    it("turns a known tool reference into a tool pill between its surrounding text", () => {
      expect(parseTextForPills(app, "Use @vault to search files", { includeTools: true })).toEqual([
        text("Use "),
        { type: "tool-pill", content: "@vault", toolName: "@vault" },
        text(" to search files"),
      ]);
    });

    it("turns an existing folder reference into a folder pill between its surrounding text", () => {
      expect(
        parseTextForPills(app, "Files in {Projects} folder", { includeCustomTemplates: true })
      ).toEqual([
        text("Files in "),
        { type: "folder-pill", content: "Projects", folder: expect.any(Object) as unknown },
        text(" folder"),
      ]);
    });

    it("matches a folder whose name contains spaces", () => {
      const result = parseTextForPills(app, "See {folder with spaces} now", {
        includeCustomTemplates: true,
      });

      expect(result.map((part) => part.type)).toEqual(["text", "folder-pill", "text"]);
      expect(result[1].content).toBe("folder with spaces");
    });

    it("strips trailing punctuation from a URL pill", () => {
      const result = parseTextForPills(app, "Visit https://example.com, for details", {
        includeURLs: true,
      });

      expect(result[1]).toEqual({
        type: "url-pill",
        content: "https://example.com",
        url: "https://example.com",
      });
    });

    it("keeps unresolvable note references as text", () => {
      expect(
        parseTextForPills(app, "Invalid [[Nonexistent Note]] reference", { includeNotes: true })
      ).toEqual([text("Invalid "), text("[[Nonexistent Note]]"), text(" reference")]);
    });

    it("keeps unknown tool references as text", () => {
      expect(parseTextForPills(app, "Use @invalid tool", { includeTools: true })).toEqual([
        text("Use "),
        text("@invalid"),
        text(" tool"),
      ]);
    });

    it("keeps nonexistent folder references as text", () => {
      expect(
        parseTextForPills(app, "Files in {Nonexistent} folder", { includeCustomTemplates: true })
      ).toEqual([text("Files in "), text("{Nonexistent}"), text(" folder")]);
    });

    it("parses each of several URLs into its own pill", () => {
      const result = parseTextForPills(app, "Visit https://example.com and http://test.org", {
        includeURLs: true,
      });

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["text", "Visit "],
        ["url-pill", "https://example.com"],
        ["text", " and "],
        ["url-pill", "http://test.org"],
      ]);
    });

    it("pills a resolvable note and keeps an unresolvable one as text in the same message", () => {
      const result = parseTextForPills(app, "[[Valid Note]] and [[Nonexistent Note]]", {
        includeNotes: true,
      });

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["note-pill", "Valid Note"],
        ["text", " and "],
        ["text", "[[Nonexistent Note]]"],
      ]);
    });

    it("parses only the pill kinds that are enabled and leaves the rest as text", () => {
      const result = parseTextForPills(app, "[[Valid Note]] https://example.com @vault", {
        includeNotes: false,
        includeURLs: true,
        includeTools: true,
      });

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["text", "[[Valid Note]] "],
        ["url-pill", "https://example.com"],
        ["text", " "],
        ["tool-pill", "@vault"],
      ]);
    });

    it("parses every pill kind in one message and leaves #tags as plain text", () => {
      const result = parseTextForPills(
        app,
        "[[Valid Note]] https://example.com @vault #test {Projects}",
        {
          includeNotes: true,
          includeURLs: true,
          includeTools: true,
          includeCustomTemplates: true,
        }
      );

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["note-pill", "Valid Note"],
        ["text", " "],
        ["url-pill", "https://example.com"],
        ["text", " "],
        ["tool-pill", "@vault"],
        ["text", " #test "],
        ["folder-pill", "Projects"],
      ]);
    });

    it("keeps invalid references as text while still pilling the valid ones around them", () => {
      const result = parseTextForPills(
        app,
        "[[Valid Note]] [[Invalid]] @vault @invalid {Projects} {Invalid}",
        {
          includeNotes: true,
          includeTools: true,
          includeCustomTemplates: true,
        }
      );

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["note-pill", "Valid Note"],
        ["text", " "],
        ["text", "[[Invalid]]"],
        ["text", " "],
        ["tool-pill", "@vault"],
        ["text", " "],
        ["text", "@invalid"],
        ["text", " "],
        ["folder-pill", "Projects"],
        ["text", " "],
        ["text", "{Invalid}"],
      ]);
    });

    it("returns the text unchanged as one text segment when no option is enabled", () => {
      const input = "Some [[note]] text with @tool and #tag and {folder} and https://example.com";

      expect(
        parseTextForPills(app, input, {
          includeNotes: false,
          includeURLs: false,
          includeTools: false,
          includeCustomTemplates: false,
        })
      ).toEqual([text(input)]);
    });

    it("returns one text segment when the text contains no references", () => {
      const input = "Just plain text without any special patterns";

      expect(
        parseTextForPills(app, input, {
          includeNotes: true,
          includeURLs: true,
          includeTools: true,
          includeCustomTemplates: true,
        })
      ).toEqual([text(input)]);
    });

    it("returns no segments for empty text", () => {
      expect(parseTextForPills(app, "")).toEqual([]);
    });

    it("splits a note reference containing brackets into two text segments", () => {
      expect(parseTextForPills(app, "[[Note with [brackets]]]", { includeNotes: true })).toEqual([
        text("[[Note with [brackets]]"),
        text("]"),
      ]);
    });
  });
});
