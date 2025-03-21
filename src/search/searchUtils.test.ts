import * as settingsModel from "@/settings/model";
import * as utils from "@/utils";
import { TFile } from "obsidian";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getMatchingPatterns,
  previewPatternValue,
  shouldIndexFile,
} from "./searchUtils";

// Mock Obsidian's TFile class
jest.mock("obsidian", () => ({
  TFile: class TFile {
    path: string;
  },
}));

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: jest.fn().mockReturnValue({
      validateLicenseKey: jest.fn().mockResolvedValue({ isValid: true, plan: "believer" }),
    }),
  },
}));

// Create test files using the mocked TFile
const createTestFile = (path: string) => {
  const file = new TFile();
  file.path = path;
  file.basename = path.split("/").pop()?.split(".")[0] || "";
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

// Add mock for settings
jest.mock("@/settings/model", () => ({
  ...jest.requireActual("@/settings/model"),
  getSettings: jest.fn().mockReturnValue({
    qaInclusions: "",
    qaExclusions: "",
  }),
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
    // Reset the settings mock before each test
    (settingsModel.getSettings as jest.Mock).mockReset();
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      qaInclusions: "",
      qaExclusions: "",
    });
  });

  describe("shouldIndexFile", () => {
    it("should return true when no inclusions or exclusions are specified", () => {
      const file = createTestFile("test.md");
      expect(shouldIndexFile(file, null, null)).toBe(true);
    });

    it("should return false when file matches exclusion pattern", () => {
      const file = createTestFile("private/secret.md");
      const exclusions = {
        folderPatterns: ["private"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
    });

    it("should return false when file matches exclusion extension pattern", () => {
      const file = createTestFile("Excalidraw/Drawing 2025-02-21 20.59.40.excalidraw.md");
      const exclusions = {
        extensionPatterns: ["*.excalidraw.md"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
    });

    it("should return true when file matches inclusion pattern", () => {
      const file = createTestFile("notes/important.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should return false when file doesn't match inclusion pattern", () => {
      const file = createTestFile("random/file.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(false);
    });

    it("should prioritize exclusions over inclusions", () => {
      const file = createTestFile("notes/private/secret.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      const exclusions = {
        folderPatterns: ["notes/private"],
      };
      expect(shouldIndexFile(file, inclusions, exclusions)).toBe(false);
    });

    it("should handle multiple inclusion patterns", () => {
      const file = createTestFile("blog/post.md");
      const inclusions = {
        folderPatterns: ["notes", "blog", "docs"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should handle inclusion patterns with folders with slashes and spaces", () => {
      const file = createTestFile("folder/with/100 spaces/post.md");
      const inclusions = {
        folderPatterns: ["folder/with/100 spaces"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should handle multiple exclusion patterns", () => {
      const file = createTestFile("temp/draft.md");
      const exclusions = {
        folderPatterns: ["private", "temp", "archive"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
    });

    it("should handle tag-based inclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["important", "review"]);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should handle tag-based exclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["private", "draft"]);

      const exclusions = {
        tagPatterns: ["#private"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
    });

    it("should handle file extension patterns in inclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const inclusions = {
        extensionPatterns: ["*.pdf"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should handle file extension patterns in exclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const exclusions = {
        extensionPatterns: ["*.pdf"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
    });

    it("should return false when tag check fails due to file not found", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(null);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(false);
    });

    it("should handle note-based inclusion patterns", () => {
      const file = createTestFile("notes/referenced.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const inclusions = {
        notePatterns: ["[[referenced]]"],
      };
      expect(shouldIndexFile(file, inclusions, null)).toBe(true);
    });

    it("should handle note-based exclusion patterns", () => {
      const file = createTestFile("notes/draft.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const exclusions = {
        notePatterns: ["[[draft]]"],
      };
      expect(shouldIndexFile(file, null, exclusions)).toBe(false);
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
      const value = "%23important,%5B%5BNote%201%5D%5D,*.pdf,folder/with/100%20spaces";
      expect(getDecodedPatterns(value)).toEqual([
        "#important",
        "[[Note 1]]",
        "*.pdf",
        "folder/with/100 spaces",
      ]);
    });
  });

  describe("getMatchingPatterns", () => {
    it("should return null inclusions and exclusions when no patterns are set", () => {
      // No need to set mock return value as it's set in beforeEach
      const { inclusions, exclusions } = getMatchingPatterns();
      expect(inclusions).toBeNull();
      expect(exclusions).toBeNull();
    });

    it("should return categorized inclusion patterns", () => {
      // Mock settings with inclusions
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "notes,*.pdf,%23important,%5B%5BNote%201%5D%5D",
        qaExclusions: "",
      });

      const { inclusions, exclusions } = getMatchingPatterns();
      expect(inclusions).toEqual({
        folderPatterns: ["notes"],
        extensionPatterns: ["*.pdf"],
        tagPatterns: ["#important"],
        notePatterns: ["[[Note 1]]"],
      });
      expect(exclusions).toBeNull();
    });

    it("should return categorized exclusion patterns", () => {
      // Mock settings with exclusions
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "private,%23draft,*.tmp",
      });

      const { inclusions, exclusions } = getMatchingPatterns();
      expect(inclusions).toBeNull();
      expect(exclusions).toEqual({
        folderPatterns: ["private"],
        tagPatterns: ["#draft"],
        extensionPatterns: ["*.tmp"],
        notePatterns: [],
      });
    });

    it("should handle both inclusions and exclusions", () => {
      // Mock settings with both inclusions and exclusions
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "notes,%23important",
        qaExclusions: "private,%23draft",
      });

      const { inclusions, exclusions } = getMatchingPatterns();
      expect(inclusions).toEqual({
        folderPatterns: ["notes"],
        tagPatterns: ["#important"],
        extensionPatterns: [],
        notePatterns: [],
      });
      expect(exclusions).toEqual({
        folderPatterns: ["private"],
        tagPatterns: ["#draft"],
        extensionPatterns: [],
        notePatterns: [],
      });
    });
  });
});
