import { parseTextForPills } from "./lexicalTextUtils";
import { TFile, TFolder } from "obsidian";

// Mock dependencies
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

// Mock the AVAILABLE_TOOLS constant
jest.mock("../constants/tools", () => ({
  AVAILABLE_TOOLS: ["@vault", "@websearch", "@composer"],
}));

// Create mock global app object
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

// Mock global app
Object.defineProperty(global, "app", {
  value: mockApp,
  writable: true,
});

describe("parseTextForPills", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("with no options enabled", () => {
    it("should return text as-is when no options are enabled", () => {
      const text = "Some [[note]] text with @tool and #tag and {folder} and https://example.com";
      const result = parseTextForPills(text, {
        includeNotes: false,
        includeURLs: false,
        includeTools: false,
        includeTags: false,
        includeFolders: false,
      });

      expect(result).toEqual([
        {
          type: "text",
          content: text,
        },
      ]);
    });
  });

  describe("with notes only", () => {
    beforeEach(() => {
      // Mock note resolution
      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((noteName: string) => {
        if (noteName === "Valid Note" || noteName === "Valid Note.md") {
          return new TFile();
        }
        return null;
      });

      // Mock TFile constructor to set properties
      (TFile as any).mockImplementation(function (this: any) {
        this.basename = "Valid Note";
        this.path = "Valid Note.md";
      });

      mockApp.workspace.getActiveFile.mockReturnValue(null);
    });

    it("should parse valid note references", () => {
      const text = "Check out [[Valid Note]] for more info";
      const result = parseTextForPills(text, { includeNotes: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Check out ",
        },
        {
          type: "note-pill",
          content: "Valid Note",
          file: expect.any(TFile),
          isActive: false,
        },
        {
          type: "text",
          content: " for more info",
        },
      ]);
    });

    it("should keep invalid note references as text", () => {
      const text = "Invalid [[Nonexistent Note]] reference";
      const result = parseTextForPills(text, { includeNotes: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Invalid ",
        },
        {
          type: "text",
          content: "[[Nonexistent Note]]",
        },
        {
          type: "text",
          content: " reference",
        },
      ]);
    });

    it("should handle multiple note references", () => {
      const text = "[[Valid Note]] and [[Nonexistent Note]]";
      const result = parseTextForPills(text, { includeNotes: true });

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe("note-pill");
      expect(result[1].content).toBe(" and ");
      expect(result[2].type).toBe("text");
      expect(result[2].content).toBe("[[Nonexistent Note]]");
    });
  });

  describe("with URLs only", () => {
    it("should parse valid URLs", () => {
      const text = "Visit https://example.com for details";
      const result = parseTextForPills(text, { includeURLs: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Visit ",
        },
        {
          type: "url-pill",
          content: "https://example.com",
          url: "https://example.com",
        },
        {
          type: "text",
          content: " for details",
        },
      ]);
    });

    it("should handle URLs with trailing commas", () => {
      const text = "Visit https://example.com, for details";
      const result = parseTextForPills(text, { includeURLs: true });

      expect(result[1].content).toBe("https://example.com");
      expect(result[1].url).toBe("https://example.com");
    });

    it("should parse multiple URLs", () => {
      const text = "Visit https://example.com and http://test.org";
      const result = parseTextForPills(text, { includeURLs: true });

      expect(result).toHaveLength(4);
      expect(result[0].content).toBe("Visit ");
      expect(result[1].type).toBe("url-pill");
      expect(result[2].content).toBe(" and ");
      expect(result[3].type).toBe("url-pill");
    });
  });

  describe("with tools only", () => {
    it("should parse valid tool references", () => {
      const text = "Use @vault to search files";
      const result = parseTextForPills(text, { includeTools: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Use ",
        },
        {
          type: "tool-pill",
          content: "@vault",
          toolName: "@vault",
        },
        {
          type: "text",
          content: " to search files",
        },
      ]);
    });

    it("should keep invalid tool references as text", () => {
      const text = "Use @invalid tool";
      const result = parseTextForPills(text, { includeTools: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Use ",
        },
        {
          type: "text",
          content: "@invalid",
        },
        {
          type: "text",
          content: " tool",
        },
      ]);
    });
  });

  describe("with tags only", () => {
    beforeEach(() => {
      // Mock tag resolution
      mockApp.vault.getMarkdownFiles.mockReturnValue([
        {
          path: "note1.md",
        },
        {
          path: "note2.md",
        },
      ]);

      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "note1.md") {
          return {
            frontmatter: {
              tags: ["project", "important"],
            },
          };
        }
        return null;
      });
    });

    it("should parse valid tag references", () => {
      const text = "This is #project related";
      const result = parseTextForPills(text, { includeTags: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "This is ",
        },
        {
          type: "tag-pill",
          content: "#project",
          tagName: "#project",
        },
        {
          type: "text",
          content: " related",
        },
      ]);
    });

    it("should keep invalid tag references as text", () => {
      const text = "This is #invalid tag";
      const result = parseTextForPills(text, { includeTags: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "This is ",
        },
        {
          type: "text",
          content: "#invalid",
        },
        {
          type: "text",
          content: " tag",
        },
      ]);
    });
  });

  describe("with folders only", () => {
    beforeEach(() => {
      // Create a mock folder using the TFolder constructor from the mock
      const mockFolder = new (TFolder as any)("Projects");

      // Mock folder resolution
      mockApp.vault.getAllLoadedFiles.mockReturnValue([mockFolder]);
    });

    it("should parse valid folder references", () => {
      const text = "Files in {Projects} folder";
      const result = parseTextForPills(text, { includeFolders: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Files in ",
        },
        {
          type: "folder-pill",
          content: "Projects",
          folder: expect.any(Object),
        },
        {
          type: "text",
          content: " folder",
        },
      ]);
    });

    it("should keep invalid folder references as text", () => {
      const text = "Files in {Nonexistent} folder";
      const result = parseTextForPills(text, { includeFolders: true });

      expect(result).toEqual([
        {
          type: "text",
          content: "Files in ",
        },
        {
          type: "text",
          content: "{Nonexistent}",
        },
        {
          type: "text",
          content: " folder",
        },
      ]);
    });
  });

  describe("with mixed options (dynamic indexing test)", () => {
    beforeEach(() => {
      // Set up mocks for all types
      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((noteName: string) => {
        if (noteName === "Test Note") return new TFile();
        return null;
      });

      (TFile as any).mockImplementation(function (this: any) {
        this.basename = "Test Note";
        this.path = "Test Note.md";
      });

      mockApp.vault.getMarkdownFiles.mockReturnValue([{ path: "note1.md" }]);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ["test"] },
      });

      const mockFolder = new (TFolder as any)("TestFolder");
      mockApp.vault.getAllLoadedFiles.mockReturnValue([mockFolder]);

      mockApp.workspace.getActiveFile.mockReturnValue(null);
    });

    it("should correctly parse when only notes and URLs are enabled", () => {
      const text = "Check [[Test Note]] and https://example.com";
      const result = parseTextForPills(text, {
        includeNotes: true,
        includeURLs: true,
      });

      expect(result).toHaveLength(4);
      expect(result[0].content).toBe("Check ");
      expect(result[1].type).toBe("note-pill");
      expect(result[2].content).toBe(" and ");
      expect(result[3].type).toBe("url-pill");
    });

    it("should correctly parse when only URLs and tools are enabled", () => {
      const text = "Visit https://example.com or use @vault";
      const result = parseTextForPills(text, {
        includeURLs: true,
        includeTools: true,
      });

      expect(result).toHaveLength(4);
      expect(result[0].content).toBe("Visit ");
      expect(result[1].type).toBe("url-pill");
      expect(result[2].content).toBe(" or use ");
      expect(result[3].type).toBe("tool-pill");
    });

    it("should correctly parse when only tools and tags are enabled", () => {
      const text = "Use @vault for #test content";
      const result = parseTextForPills(text, {
        includeTools: true,
        includeTags: true,
      });

      expect(result).toHaveLength(5);
      expect(result[0].content).toBe("Use ");
      expect(result[1].type).toBe("tool-pill");
      expect(result[2].content).toBe(" for ");
      expect(result[3].type).toBe("tag-pill");
      expect(result[4].content).toBe(" content");
    });

    it("should correctly parse when all options are enabled", () => {
      const text = "[[Test Note]] https://example.com @vault #test {TestFolder}";
      const result = parseTextForPills(text, {
        includeNotes: true,
        includeURLs: true,
        includeTools: true,
        includeTags: true,
        includeFolders: true,
      });

      expect(result).toHaveLength(9);
      expect(result[0].type).toBe("note-pill");
      expect(result[1].content).toBe(" ");
      expect(result[2].type).toBe("url-pill");
      expect(result[3].content).toBe(" ");
      expect(result[4].type).toBe("tool-pill");
      expect(result[5].content).toBe(" ");
      expect(result[6].type).toBe("tag-pill");
      expect(result[7].content).toBe(" ");
      expect(result[8].type).toBe("folder-pill");
    });

    it("should handle mixed valid and invalid references", () => {
      const text =
        "[[Test Note]] [[Invalid]] @vault @invalid #test #invalid {TestFolder} {Invalid}";
      const result = parseTextForPills(text, {
        includeNotes: true,
        includeTools: true,
        includeTags: true,
        includeFolders: true,
      });

      // Should have: note-pill, space, text, space, tool-pill, space, text, space, tag-pill, space, text, space, folder-pill, space, text
      expect(result).toHaveLength(15);
      expect(result[0].type).toBe("note-pill");
      expect(result[2].type).toBe("text");
      expect(result[2].content).toBe("[[Invalid]]");
      expect(result[4].type).toBe("tool-pill");
      expect(result[6].type).toBe("text");
      expect(result[6].content).toBe("@invalid");
      expect(result[8].type).toBe("tag-pill");
      expect(result[10].type).toBe("text");
      expect(result[10].content).toBe("#invalid");
      expect(result[12].type).toBe("folder-pill");
      expect(result[14].type).toBe("text");
      expect(result[14].content).toBe("{Invalid}");
    });
  });

  describe("edge cases", () => {
    it("should handle empty text", () => {
      const result = parseTextForPills("");
      expect(result).toEqual([]);
    });

    it("should handle text with no matches", () => {
      const text = "Just plain text without any special patterns";
      const result = parseTextForPills(text, {
        includeNotes: true,
        includeURLs: true,
        includeTools: true,
        includeTags: true,
        includeFolders: true,
      });

      expect(result).toEqual([
        {
          type: "text",
          content: text,
        },
      ]);
    });

    it("should handle nested brackets correctly", () => {
      const text = "[[Note with [brackets]]]";
      const result = parseTextForPills(text, { includeNotes: true });

      // The regex matches [[Note with [brackets]] and leaves the final ]]
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("text"); // Should be treated as text since it's not a valid note
      expect(result[0].content).toBe("[[Note with [brackets]]");
      expect(result[1].type).toBe("text");
      expect(result[1].content).toBe("]");
    });

    it("should handle special characters in patterns", () => {
      const text = "@tool-name #tag_with_underscores {folder with spaces}";

      // Mock folder resolution for folder with spaces
      const mockFolder = new (TFolder as any)("folder with spaces");
      mockApp.vault.getAllLoadedFiles.mockReturnValue([mockFolder]);

      // Mock tag resolution for underscored tag
      mockApp.vault.getMarkdownFiles.mockReturnValue([{ path: "note1.md" }]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ["tag_with_underscores"] },
      });

      const result = parseTextForPills(text, {
        includeTools: true,
        includeTags: true,
        includeFolders: true,
      });

      // @tool matches as invalid tool (not in AVAILABLE_TOOLS), tags and folders should match completely
      expect(result).toHaveLength(5);
      expect(result[0].type).toBe("text"); // @tool (not a valid tool, treated as text)
      expect(result[0].content).toBe("@tool");
      expect(result[1].type).toBe("text");
      expect(result[1].content).toBe("-name ");
      expect(result[2].type).toBe("tag-pill"); // #tag_with_underscores (underscore is allowed)
      expect(result[3].type).toBe("text");
      expect(result[3].content).toBe(" ");
      expect(result[4].type).toBe("folder-pill"); // {folder with spaces}
    });
  });
});
