import { TFile } from "obsidian";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  previewPatternValue,
  shouldIndexFile,
} from "./searchUtils";
import * as utils from "@/utils";

// Mock Obsidian's TFile class
jest.mock("obsidian", () => ({
  TFile: class TFile {
    path: string;
  },
}));

// Create test files using the mocked TFile
const createTestFile = (path: string) => {
  const file = new TFile();
  file.path = path;
  return file;
};

// Mock the global app object
const mockGetAbstractFileByPath = jest.fn();
const mockApp = {
  vault: {
    getAbstractFileByPath: mockGetAbstractFileByPath,
  },
} as any;

// Mock getTagsFromNote utility function
jest.mock("@/utils", () => ({
  ...jest.requireActual("@/utils"),
  getTagsFromNote: jest.fn(),
}));

describe("searchUtils", () => {
  beforeAll(() => {
    // @ts-ignore
    global.app = mockApp;
  });

  afterAll(() => {
    // @ts-ignore
    delete global.app;
  });

  beforeEach(() => {
    mockGetAbstractFileByPath.mockReset();
    (utils.getTagsFromNote as jest.Mock).mockReset();
  });

  describe("shouldIndexFile", () => {
    it("should return true when no inclusions or exclusions are specified", () => {
      const file = createTestFile("test.md");
      expect(shouldIndexFile(file, [], [])).toBe(true);
    });

    it("should return false when file matches exclusion pattern", () => {
      const file = createTestFile("private/secret.md");
      const exclusions = ["private"];
      expect(shouldIndexFile(file, [], exclusions)).toBe(false);
    });

    it("should return true when file matches inclusion pattern", () => {
      const file = createTestFile("notes/important.md");
      const inclusions = ["notes"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(true);
    });

    it("should return false when file doesn't match inclusion pattern", () => {
      const file = createTestFile("random/file.md");
      const inclusions = ["notes"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(false);
    });

    it("should prioritize exclusions over inclusions", () => {
      const file = createTestFile("notes/private/secret.md");
      const inclusions = ["notes"];
      const exclusions = ["notes/private"];
      expect(shouldIndexFile(file, inclusions, exclusions)).toBe(false);
    });

    it("should handle multiple inclusion patterns", () => {
      const file = createTestFile("blog/post.md");
      const inclusions = ["notes", "blog", "docs"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(true);
    });

    it("should handle multiple exclusion patterns", () => {
      const file = createTestFile("temp/draft.md");
      const exclusions = ["private", "temp", "archive"];
      expect(shouldIndexFile(file, [], exclusions)).toBe(false);
    });

    it("should handle tag-based inclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["important", "review"]);

      const inclusions = ["#important"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(true);
    });

    it("should handle tag-based exclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["private", "draft"]);

      const exclusions = ["#private"];
      expect(shouldIndexFile(file, [], exclusions)).toBe(false);
    });

    it("should handle file extension patterns in inclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const inclusions = ["*.pdf"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(true);
    });

    it("should handle file extension patterns in exclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const exclusions = ["*.pdf"];
      expect(shouldIndexFile(file, [], exclusions)).toBe(false);
    });

    it("should return false when tag check fails due to file not found", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(null);

      const inclusions = ["#important"];
      expect(shouldIndexFile(file, inclusions, [])).toBe(false);
    });
  });

  describe("categorizePatterns", () => {
    it("should correctly categorize tag patterns", () => {
      const patterns = ["#important", "#draft", "#review"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual(patterns);
      expect(extensionPatterns).toEqual([]);
      expect(folderPatterns).toEqual([]);
      expect(notePatterns).toEqual([]);
    });

    it("should correctly categorize extension patterns", () => {
      const patterns = ["*.pdf", "*.md", "*.doc"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual([]);
      expect(extensionPatterns).toEqual(patterns);
      expect(folderPatterns).toEqual([]);
      expect(notePatterns).toEqual([]);
    });

    it("should correctly categorize folder patterns", () => {
      const patterns = ["folder1", "folder2/subfolder", "documents"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual([]);
      expect(extensionPatterns).toEqual([]);
      expect(folderPatterns).toEqual(patterns);
      expect(notePatterns).toEqual([]);
    });

    it("should correctly categorize note patterns", () => {
      const patterns = ["[[Note 1]]", "[[Important Note]]", "[[Draft]]"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual([]);
      expect(extensionPatterns).toEqual([]);
      expect(folderPatterns).toEqual([]);
      expect(notePatterns).toEqual(patterns);
    });

    it("should correctly categorize mixed patterns", () => {
      const patterns = ["#important", "*.pdf", "folder1", "[[Note 1]]"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual(["#important"]);
      expect(extensionPatterns).toEqual(["*.pdf"]);
      expect(folderPatterns).toEqual(["folder1"]);
      expect(notePatterns).toEqual(["[[Note 1]]"]);
    });
  });

  describe("previewPatternValue", () => {
    it("should correctly preview a single pattern", () => {
      const value = "folder1";
      expect(previewPatternValue(value)).toBe("folder1");
    });

    it("should correctly preview multiple patterns", () => {
      const value = "folder1,folder2,folder3";
      expect(previewPatternValue(value)).toBe("folder1, folder2, folder3");
    });

    it("should handle encoded patterns", () => {
      const value = "folder%201,folder%202,folder%203";
      expect(previewPatternValue(value)).toBe("folder 1, folder 2, folder 3");
    });

    it("should handle empty string", () => {
      expect(previewPatternValue("")).toBe("");
    });

    it("should handle patterns with spaces and special characters", () => {
      const value = "folder%20with%20spaces,special%23chars,%23tag";
      expect(previewPatternValue(value)).toBe("folder with spaces, special#chars, #tag");
    });
  });

  describe("createPatternSettingsValue", () => {
    it("should create settings value from single category", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#important"],
        extensionPatterns: [],
        folderPatterns: [],
        notePatterns: [],
      });
      expect(result).toBe("%23important");
    });

    it("should create settings value from multiple categories", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#important"],
        extensionPatterns: ["*.pdf"],
        folderPatterns: ["folder1"],
        notePatterns: ["[[Note 1]]"],
      });
      expect(result).toBe("%23important,*.pdf,%5B%5BNote%201%5D%5D,folder1");
    });

    it("should handle empty arrays", () => {
      const result = createPatternSettingsValue({
        tagPatterns: [],
        extensionPatterns: [],
        folderPatterns: [],
        notePatterns: [],
      });
      expect(result).toBe("");
    });

    it("should properly encode special characters", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#special tag"],
        extensionPatterns: [],
        folderPatterns: ["folder with spaces"],
        notePatterns: [],
      });
      expect(result).toBe("%23special%20tag,folder%20with%20spaces");
    });

    it("should maintain pattern order", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#tag1", "#tag2"],
        extensionPatterns: ["*.pdf"],
        folderPatterns: ["folder1"],
        notePatterns: ["[[Note 1]]"],
      });
      expect(result).toBe("%23tag1,%23tag2,*.pdf,%5B%5BNote%201%5D%5D,folder1");
    });
  });

  describe("getDecodedPatterns", () => {
    it("should decode a single pattern", () => {
      const value = "folder1";
      expect(getDecodedPatterns(value)).toEqual(["folder1"]);
    });

    it("should decode multiple patterns", () => {
      const value = "folder1,folder2,folder3";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("should handle URL encoded characters", () => {
      const value = "folder%20with%20spaces,special%23chars,%23tag";
      expect(getDecodedPatterns(value)).toEqual(["folder with spaces", "special#chars", "#tag"]);
    });

    it("should handle empty string", () => {
      expect(getDecodedPatterns("")).toEqual([]);
    });

    it("should trim whitespace from patterns", () => {
      const value = " folder1 , folder2 , folder3 ";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("should filter out empty patterns", () => {
      const value = "folder1,,folder2, ,folder3";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("should handle complex patterns", () => {
      const value = "%23important,%5B%5BNote%201%5D%5D,*.pdf,folder/with/path";
      expect(getDecodedPatterns(value)).toEqual([
        "#important",
        "[[Note 1]]",
        "*.pdf",
        "folder/with/path",
      ]);
    });
  });
});
