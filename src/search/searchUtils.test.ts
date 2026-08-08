import * as obsidian from "obsidian";
import * as settingsModel from "@/settings/model";
import * as utils from "@/utils";
import { TFile } from "obsidian";
import {
  categorizePatterns,
  createCopilotPatternFilter,
  createPatternSettingsValue,
  getDecodedPatterns,
  getMatchingPatterns,
  getPropertyPattern,
  getSystemExcludedFolders,
  isInternalExcludedPath,
  parsePropertyPattern,
  previewPatternValue,
  shouldIndexFile,
} from "./searchUtils";

// Mock Obsidian's TFile and Modal classes
jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
  // Mutable so a test can assert the case-sensitive and case-insensitive
  // behaviours of system-root matching on one platform.
  Platform: { isWin: false, isMacOS: true, isIosApp: false },
  TFile: class TFile {
    path: string;
  },
  Modal: class Modal {
    app: unknown;
    constructor(app: unknown) {
      this.app = app;
    }
    open() {}
    close() {}
  },
  Notice: jest.fn(),
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
} as unknown as typeof window.app;

// Mock getTagsFromNote utility function
jest.mock(
  "@/utils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/utils"),
    getTagsFromNote: jest.fn(),
    getPropertyValuesFromNote: jest.fn(),
    noteHasProperty: jest.fn(),
  })
);

// Add mock for settings
jest.mock(
  "@/settings/model",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/settings/model"),
    getSettings: jest.fn().mockReturnValue({
      qaInclusions: "",
      qaExclusions: "",
    }),
  })
);

describe("searchUtils", () => {
  beforeAll(() => {
    // @ts-ignore
    window.app = mockApp;
  });

  afterAll(() => {
    // @ts-ignore
    delete window.app;
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
      expect(shouldIndexFile(window.app, file, null, null)).toBe(true);
    });

    it("excludes canonical instruction files from search and indexing", () => {
      expect(shouldIndexFile(window.app, createTestFile("AGENTS.md"), null, null)).toBe(false);
      expect(shouldIndexFile(window.app, createTestFile("CLAUDE.md"), null, null)).toBe(false);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        projectsFolder: "copilot/projects",
      });
      expect(
        shouldIndexFile(
          window.app,
          createTestFile("copilot/projects/research/AGENTS.md"),
          null,
          null
        )
      ).toBe(false);
      expect(
        shouldIndexFile(
          window.app,
          createTestFile("copilot/projects/research/CLAUDE.md"),
          null,
          null
        )
      ).toBe(false);
    });

    it("should return false when file matches exclusion pattern", () => {
      const file = createTestFile("private/secret.md");
      const exclusions = {
        folderPatterns: ["private"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should return false when file matches exclusion extension pattern", () => {
      const file = createTestFile("Excalidraw/Drawing 2025-02-21 20.59.40.excalidraw.md");
      const exclusions = {
        extensionPatterns: ["*.excalidraw.md"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should return true when file matches inclusion pattern", () => {
      const file = createTestFile("notes/important.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should return false when file doesn't match inclusion pattern", () => {
      const file = createTestFile("random/file.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("should prioritize exclusions over inclusions", () => {
      const file = createTestFile("notes/private/secret.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      const exclusions = {
        folderPatterns: ["notes/private"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, exclusions)).toBe(false);
    });

    it("should handle multiple inclusion patterns", () => {
      const file = createTestFile("blog/post.md");
      const inclusions = {
        folderPatterns: ["notes", "blog", "docs"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should handle inclusion patterns with folders with slashes and spaces", () => {
      const file = createTestFile("folder/with/100 spaces/post.md");
      const inclusions = {
        folderPatterns: ["folder/with/100 spaces"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should handle multiple exclusion patterns", () => {
      const file = createTestFile("temp/draft.md");
      const exclusions = {
        folderPatterns: ["private", "temp", "archive"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should handle tag-based inclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["important", "review"]);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should handle tag-based exclusion patterns", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["private", "draft"]);

      const exclusions = {
        tagPatterns: ["#private"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should handle file extension patterns in inclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const inclusions = {
        extensionPatterns: ["*.pdf"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should handle file extension patterns in exclusions", () => {
      const file = createTestFile("notes/document.pdf");
      const exclusions = {
        extensionPatterns: ["*.pdf"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should return false when the note has no matching tags", () => {
      const file = createTestFile("notes/tagged.md");
      (utils.getTagsFromNote as jest.Mock).mockReturnValue([]);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("should handle note-based inclusion patterns", () => {
      const file = createTestFile("notes/referenced.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const inclusions = {
        notePatterns: ["[[referenced]]"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should handle note-based exclusion patterns", () => {
      const file = createTestFile("notes/draft.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const exclusions = {
        notePatterns: ["[[draft]]"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("should include a note whose property value matches", () => {
      const file = createTestFile("notes/physics.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["Physics", "Math"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should match a property value case-insensitively", () => {
      const file = createTestFile("notes/physics.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["physics"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should exclude a note whose property value does not match", () => {
      const file = createTestFile("notes/chem.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["Chemistry"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("should include any note that has the key for a key-only property pattern", () => {
      const file = createTestFile("notes/any.md");
      // A key-only pattern matches on key presence, even when the value is empty.
      (utils.noteHasProperty as jest.Mock).mockReturnValue(true);

      const inclusions = { propertyPatterns: ["[Topics:]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("should exclude a note missing the key for a key-only property pattern", () => {
      const file = createTestFile("notes/none.md");
      (utils.noteHasProperty as jest.Mock).mockReturnValue(false);

      const inclusions = { propertyPatterns: ["[Topics:]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
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

    it("should correctly categorize property patterns", () => {
      const patterns = ["[Topics:Physics]", "[Subject:Einstein]", "[Token:]"];
      const { propertyPatterns, tagPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(propertyPatterns).toEqual(patterns);
      expect(tagPatterns).toEqual([]);
      expect(folderPatterns).toEqual([]);
      expect(notePatterns).toEqual([]);
    });

    it("should not mistake a double-bracket note pattern for a property", () => {
      // A note title may itself contain a colon; the double-bracket form must
      // still win over the single-bracket property form.
      const { notePatterns, propertyPatterns } = categorizePatterns(["[[Note 1]]", "[[Topics:x]]"]);

      expect(notePatterns).toEqual(["[[Note 1]]", "[[Topics:x]]"]);
      expect(propertyPatterns).toEqual([]);
    });

    it("should treat a bracketed value with an empty key as a folder, not a property", () => {
      const { folderPatterns, propertyPatterns } = categorizePatterns(["[:onlyvalue]"]);

      expect(propertyPatterns).toEqual([]);
      expect(folderPatterns).toEqual(["[:onlyvalue]"]);
    });

    it("should correctly categorize mixed patterns", () => {
      const patterns = ["#important", "*.pdf", "folder1", "[[Note 1]]", "[Topics:Physics]"];
      const { tagPatterns, extensionPatterns, folderPatterns, notePatterns, propertyPatterns } =
        categorizePatterns(patterns);

      expect(tagPatterns).toEqual(["#important"]);
      expect(extensionPatterns).toEqual(["*.pdf"]);
      expect(folderPatterns).toEqual(["folder1"]);
      expect(notePatterns).toEqual(["[[Note 1]]"]);
      expect(propertyPatterns).toEqual(["[Topics:Physics]"]);
    });
  });

  describe("parsePropertyPattern()", () => {
    it("splits a property pattern into trimmed key and value", () => {
      expect(parsePropertyPattern("[Topics:Physics]")).toEqual({
        key: "Topics",
        value: "Physics",
      });
    });

    it("keeps spaces and later colons inside the value by splitting on the first colon", () => {
      expect(parsePropertyPattern("[Subject:2024: a talk]")).toEqual({
        key: "Subject",
        value: "2024: a talk",
      });
    });

    it("returns an empty value for a key-only pattern", () => {
      expect(parsePropertyPattern("[Topics:]")).toEqual({ key: "Topics", value: "" });
    });

    it("returns null for a non-property pattern", () => {
      expect(parsePropertyPattern("[[Note]]")).toBeNull();
      expect(parsePropertyPattern("folder1")).toBeNull();
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

    it("should round-trip a property pattern through categorizePatterns", () => {
      const value = createPatternSettingsValue({ propertyPatterns: ["[Topics:Physics]"] });
      expect(categorizePatterns(getDecodedPatterns(value)).propertyPatterns).toEqual([
        "[Topics:Physics]",
      ]);
    });

    it("should round-trip a property value containing commas and percent signs", () => {
      // The stored form is a comma-joined, percent-encoded list, so a value with
      // its own commas or percent signs must survive encode -> decode intact.
      const pattern = "[Topics:a, b 50%]";
      const value = createPatternSettingsValue({ propertyPatterns: [pattern] });
      expect(categorizePatterns(getDecodedPatterns(value)).propertyPatterns).toEqual([pattern]);
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

    it("should handle malformed URI sequences gracefully", () => {
      // Invalid % sequences that would throw URIError
      const value = "bad%2,valid,bad%zz,%E0%A4";
      expect(getDecodedPatterns(value)).toEqual(["bad%2", "valid", "bad%zz", "%E0%A4"]);
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
        propertyPatterns: [],
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
        propertyPatterns: [],
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
        propertyPatterns: [],
      });
      expect(exclusions).toEqual({
        folderPatterns: ["private"],
        tagPatterns: ["#draft"],
        extensionPatterns: [],
        notePatterns: [],
        propertyPatterns: [],
      });
    });
  });

  describe("getSystemExcludedFolders", () => {
    it("always includes the historical copilot root", () => {
      const folders = getSystemExcludedFolders({
        copilotFolder: "copilot",
        copilotRootHistory: [],
      } as unknown as Parameters<typeof getSystemExcludedFolders>[0]);
      expect(folders).toContain("copilot");
    });

    it("includes the active root and every historical root", () => {
      const folders = getSystemExcludedFolders({
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai"],
      } as unknown as Parameters<typeof getSystemExcludedFolders>[0]);
      expect(new Set(folders)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("normalizes and dedupes without lowercasing (matcher is case-sensitive)", () => {
      const folders = getSystemExcludedFolders({
        copilotFolder: "Copilot/",
        copilotRootHistory: ["copilot", "Copilot"],
      } as unknown as Parameters<typeof getSystemExcludedFolders>[0]);
      // "Copilot" (trailing slash stripped) and "copilot" stay distinct entries.
      expect(new Set(folders)).toEqual(new Set(["copilot", "Copilot"]));
    });
  });

  describe("isInternalExcludedPath", () => {
    it("excludes project-config files under the projects folder derived from the default root", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "copilot",
      });
      expect(isInternalExcludedPath("copilot/projects/my-project/project.md")).toBe(true);
    });

    it("derives the projects folder from a custom root, not the retired projectsFolder field", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "team-ai",
        // Retired field left pointing at the stale default path; derivation must ignore it.
        projectsFolder: "copilot/projects",
      });
      // Excluded under the derived custom-root path.
      expect(isInternalExcludedPath("team-ai/projects/my-project/project.md")).toBe(true);
      // NOT excluded under the stale retired path, proving derivation from the root.
      expect(isInternalExcludedPath("copilot/projects/my-project/project.md")).toBe(false);
    });

    it("does not exclude ordinary user files that merely live under the projects folder", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "team-ai",
      });
      expect(isInternalExcludedPath("team-ai/projects/my-project/notes.md")).toBe(false);
    });
  });

  describe("createCopilotPatternFilter", () => {
    it("excludes the active and historical roots even with no user patterns", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "ai",
        copilotRootHistory: ["copilot", "ai"],
      });
      const filter = createCopilotPatternFilter(window.app);
      // System roots dropped on the raw path — no TFile resolution required.
      expect(filter("ai/memory/note.md")).toBe(false);
      expect(filter("copilot/copilot-conversations/chat.md")).toBe(false);
      expect(filter("notes/idea.md")).toBe(true);
      expect(mockGetAbstractFileByPath).not.toHaveBeenCalledWith("ai/memory/note.md");
    });

    it("excludes root instruction files even with no user patterns configured", () => {
      // Default QA settings take the no-pattern fast path; the instruction-file
      // exclusion must hold there too, or vault-root AGENTS.md/CLAUDE.md surface
      // in relevant-note and Miyo results despite being agent-facing content.
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      const filter = createCopilotPatternFilter(window.app);
      expect(filter("AGENTS.md")).toBe(false);
      expect(filter("CLAUDE.md")).toBe(false);
      expect(filter("copilot/projects/Research/AGENTS.md")).toBe(false);
      expect(filter("notes/AGENTS review.md")).toBe(true);
    });

    it("does not over-match a sibling folder that merely shares the root's prefix", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      const filter = createCopilotPatternFilter(window.app);
      // Segment boundary: "mycopilot/" is not the "copilot" root.
      expect(filter("mycopilot/note.md")).toBe(true);
    });

    it("excludes differently-cased instruction files where the filesystem is case-insensitive", () => {
      // On macOS a pre-existing `agents.md` IS the file the backends read when they ask for
      // `AGENTS.md`, so exact-case comparison would let live instructions into search.
      (obsidian.Platform as { isMacOS: boolean }).isMacOS = true;
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      const filter = createCopilotPatternFilter(window.app);
      expect(filter("agents.md")).toBe(false);
      expect(filter("Claude.md")).toBe(false);
      expect(filter("Copilot/Projects/Research/agents.md")).toBe(false);
    });

    it("excludes a differently-cased root where the filesystem is case-insensitive", () => {
      // On macOS/Windows, "Copilot/" and "copilot/" are the same folder. Nothing
      // reconciles the stored spelling against the real one, so comparing
      // exact-case here would fail OPEN and let chats reach QA indexing.
      (obsidian.Platform as { isMacOS: boolean }).isMacOS = true;
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });

      expect(createCopilotPatternFilter(window.app)("Copilot/note.md")).toBe(false);
    });

    it("keeps a differently-cased folder where the filesystem is case-sensitive", () => {
      // On Linux the two really are separate folders, so folding would exclude
      // notes the user never put under a Copilot root.
      const platform = obsidian.Platform as { isWin: boolean; isMacOS: boolean; isIosApp: boolean };
      const restore = { ...platform };
      Object.assign(platform, { isWin: false, isMacOS: false, isIosApp: false });
      try {
        (settingsModel.getSettings as jest.Mock).mockReturnValue({
          qaInclusions: "",
          qaExclusions: "",
          copilotFolder: "copilot",
          copilotRootHistory: ["copilot"],
        });

        expect(createCopilotPatternFilter(window.app)("Copilot/note.md")).toBe(true);
      } finally {
        Object.assign(platform, restore);
      }
    });
  });

  describe("getPropertyPattern()", () => {
    it("returns [key:value] when value is provided", () => {
      expect(getPropertyPattern("Topics", "Physics")).toBe("[Topics:Physics]");
    });

    it("returns [key:] when value is omitted", () => {
      expect(getPropertyPattern("Topics")).toBe("[Topics:]");
    });

    it("returns [key:] when value is empty string", () => {
      expect(getPropertyPattern("Topics", "")).toBe("[Topics:]");
    });
  });
});
