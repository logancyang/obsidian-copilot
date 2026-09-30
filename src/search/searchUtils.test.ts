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
  shouldIndexFile,
} from "./searchUtils";

jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
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

const createTestFile = (path: string) => {
  const file = new TFile();
  file.path = path;
  file.basename = path.split("/").pop()?.split(".")[0] || "";
  return file;
};

const mockGetAbstractFileByPath = jest.fn();
const mockApp = {
  vault: {
    getAbstractFileByPath: mockGetAbstractFileByPath,
  },
} as unknown as typeof window.app;

jest.mock(
  "@/utils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/utils"),
    getTagsFromNote: jest.fn(),
    getPropertyValuesFromNote: jest.fn(),
    noteHasProperty: jest.fn(),
  })
);

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
    (settingsModel.getSettings as jest.Mock).mockReset();
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      qaInclusions: "",
      qaExclusions: "",
    });
  });

  describe("shouldIndexFile()", () => {
    it("indexes a file when no inclusion or exclusion rules are set", () => {
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

    it("skips a file inside an excluded folder", () => {
      const file = createTestFile("private/secret.md");
      const exclusions = {
        folderPatterns: ["private"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("skips a file whose multi-dot extension matches an excluded extension pattern", () => {
      const file = createTestFile("Excalidraw/Drawing 2025-02-21 20.59.40.excalidraw.md");
      const exclusions = {
        extensionPatterns: ["*.excalidraw.md"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("indexes a file inside an included folder", () => {
      const file = createTestFile("notes/important.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a file outside every included folder", () => {
      const file = createTestFile("random/file.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("skips a file that is both included and excluded", () => {
      const file = createTestFile("notes/private/secret.md");
      const inclusions = {
        folderPatterns: ["notes"],
      };
      const exclusions = {
        folderPatterns: ["notes/private"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, exclusions)).toBe(false);
    });

    it("indexes a file that matches any one of several included folders", () => {
      const file = createTestFile("blog/post.md");
      const inclusions = {
        folderPatterns: ["notes", "blog", "docs"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("indexes a file inside an included nested folder whose name has spaces", () => {
      const file = createTestFile("folder/with/100 spaces/post.md");
      const inclusions = {
        folderPatterns: ["folder/with/100 spaces"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a file that matches any one of several excluded folders", () => {
      const file = createTestFile("temp/draft.md");
      const exclusions = {
        folderPatterns: ["private", "temp", "archive"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("indexes a note carrying an included tag", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["important", "review"]);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a note carrying an excluded tag", () => {
      const file = createTestFile("notes/tagged.md");
      mockGetAbstractFileByPath.mockReturnValue(file);
      (utils.getTagsFromNote as jest.Mock).mockReturnValue(["private", "draft"]);

      const exclusions = {
        tagPatterns: ["#private"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("indexes a file with an included extension", () => {
      const file = createTestFile("notes/document.pdf");
      const inclusions = {
        extensionPatterns: ["*.pdf"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a note without any included tag", () => {
      const file = createTestFile("notes/tagged.md");
      (utils.getTagsFromNote as jest.Mock).mockReturnValue([]);

      const inclusions = {
        tagPatterns: ["#important"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("indexes a note named by an included note pattern", () => {
      const file = createTestFile("notes/referenced.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const inclusions = {
        notePatterns: ["[[referenced]]"],
      };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a note named by an excluded note pattern", () => {
      const file = createTestFile("notes/draft.md");
      mockGetAbstractFileByPath.mockReturnValue(file);

      const exclusions = {
        notePatterns: ["[[draft]]"],
      };
      expect(shouldIndexFile(window.app, file, null, exclusions)).toBe(false);
    });

    it("indexes a note whose property value matches an included property pattern", () => {
      const file = createTestFile("notes/physics.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["Physics", "Math"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("matches an included property value case-insensitively", () => {
      const file = createTestFile("notes/physics.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["physics"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a note whose property value differs from the included property pattern", () => {
      const file = createTestFile("notes/chem.md");
      (utils.getPropertyValuesFromNote as jest.Mock).mockReturnValue(["Chemistry"]);

      const inclusions = { propertyPatterns: ["[Topics:Physics]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });

    it("indexes any note that has the key of a key-only property pattern", () => {
      const file = createTestFile("notes/any.md");
      (utils.noteHasProperty as jest.Mock).mockReturnValue(true);

      const inclusions = { propertyPatterns: ["[Topics:]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(true);
    });

    it("skips a note missing the key of a key-only property pattern", () => {
      const file = createTestFile("notes/none.md");
      (utils.noteHasProperty as jest.Mock).mockReturnValue(false);

      const inclusions = { propertyPatterns: ["[Topics:]"] };
      expect(shouldIndexFile(window.app, file, inclusions, null)).toBe(false);
    });
  });

  describe("categorizePatterns()", () => {
    it("groups key-only and valued property patterns as property patterns", () => {
      const patterns = ["[Topics:Physics]", "[Subject:Einstein]", "[Token:]"];
      const { propertyPatterns, tagPatterns, folderPatterns, notePatterns } =
        categorizePatterns(patterns);

      expect(propertyPatterns).toEqual(patterns);
      expect(tagPatterns).toEqual([]);
      expect(folderPatterns).toEqual([]);
      expect(notePatterns).toEqual([]);
    });

    it("keeps double-bracket note patterns out of property patterns", () => {
      const { notePatterns, propertyPatterns } = categorizePatterns(["[[Note 1]]", "[[Topics:x]]"]);

      expect(notePatterns).toEqual(["[[Note 1]]", "[[Topics:x]]"]);
      expect(propertyPatterns).toEqual([]);
    });

    it("treats a bracketed value with an empty key as a folder pattern", () => {
      const { folderPatterns, propertyPatterns } = categorizePatterns(["[:onlyvalue]"]);

      expect(propertyPatterns).toEqual([]);
      expect(folderPatterns).toEqual(["[:onlyvalue]"]);
    });

    it("sorts a mixed pattern list into tag, extension, folder, note, and property groups", () => {
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

  describe("createPatternSettingsValue()", () => {
    it("joins encoded tag, extension, note, and folder patterns in that order", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#important"],
        extensionPatterns: ["*.pdf"],
        folderPatterns: ["folder1"],
        notePatterns: ["[[Note 1]]"],
      });
      expect(result).toBe("%23important,*.pdf,%5B%5BNote%201%5D%5D,folder1");
    });

    it("returns an empty string when every category is empty", () => {
      const result = createPatternSettingsValue({
        tagPatterns: [],
        extensionPatterns: [],
        folderPatterns: [],
        notePatterns: [],
      });
      expect(result).toBe("");
    });

    it("percent-encodes spaces and hashes in patterns", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#special tag"],
        extensionPatterns: [],
        folderPatterns: ["folder with spaces"],
        notePatterns: [],
      });
      expect(result).toBe("%23special%20tag,folder%20with%20spaces");
    });

    it("keeps the order of patterns within a category", () => {
      const result = createPatternSettingsValue({
        tagPatterns: ["#tag1", "#tag2"],
        extensionPatterns: ["*.pdf"],
        folderPatterns: ["folder1"],
        notePatterns: ["[[Note 1]]"],
      });
      expect(result).toBe("%23tag1,%23tag2,*.pdf,%5B%5BNote%201%5D%5D,folder1");
    });

    it("round-trips a property pattern through decoding and categorization", () => {
      const value = createPatternSettingsValue({ propertyPatterns: ["[Topics:Physics]"] });
      expect(categorizePatterns(getDecodedPatterns(value)).propertyPatterns).toEqual([
        "[Topics:Physics]",
      ]);
    });

    it("round-trips a property value containing commas and percent signs", () => {
      const pattern = "[Topics:a, b 50%]";
      const value = createPatternSettingsValue({ propertyPatterns: [pattern] });
      expect(categorizePatterns(getDecodedPatterns(value)).propertyPatterns).toEqual([pattern]);
    });
  });

  describe("getDecodedPatterns()", () => {
    it("splits a comma-separated value into patterns", () => {
      const value = "folder1,folder2,folder3";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("decodes percent-encoded characters", () => {
      const value = "folder%20with%20spaces,special%23chars,%23tag";
      expect(getDecodedPatterns(value)).toEqual(["folder with spaces", "special#chars", "#tag"]);
    });

    it("returns no patterns for an empty string", () => {
      expect(getDecodedPatterns("")).toEqual([]);
    });

    it("trims whitespace around each pattern", () => {
      const value = " folder1 , folder2 , folder3 ";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("drops empty and blank patterns", () => {
      const value = "folder1,,folder2, ,folder3";
      expect(getDecodedPatterns(value)).toEqual(["folder1", "folder2", "folder3"]);
    });

    it("decodes a mixed list of tag, note, extension, and nested folder patterns", () => {
      const value = "%23important,%5B%5BNote%201%5D%5D,*.pdf,folder/with/100%20spaces";
      expect(getDecodedPatterns(value)).toEqual([
        "#important",
        "[[Note 1]]",
        "*.pdf",
        "folder/with/100 spaces",
      ]);
    });

    it("keeps malformed percent sequences as literal text", () => {
      const value = "bad%2,valid,bad%zz,%E0%A4";
      expect(getDecodedPatterns(value)).toEqual(["bad%2", "valid", "bad%zz", "%E0%A4"]);
    });
  });

  describe("getMatchingPatterns()", () => {
    it("returns null inclusions and exclusions when no patterns are set", () => {
      const { inclusions, exclusions } = getMatchingPatterns();
      expect(inclusions).toBeNull();
      expect(exclusions).toBeNull();
    });

    it("categorizes the inclusion setting", () => {
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

    it("categorizes the exclusion setting", () => {
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

    it("categorizes inclusion and exclusion settings independently", () => {
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

  describe("getSystemExcludedFolders()", () => {
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
      expect(new Set(folders)).toEqual(new Set(["copilot", "Copilot"]));
    });
  });

  describe("isInternalExcludedPath()", () => {
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
        projectsFolder: "copilot/projects",
      });
      expect(isInternalExcludedPath("team-ai/projects/my-project/project.md")).toBe(true);
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

  describe("createCopilotPatternFilter()", () => {
    it("excludes the active and historical roots even with no user patterns", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "",
        copilotFolder: "ai",
        copilotRootHistory: ["copilot", "ai"],
      });
      const filter = createCopilotPatternFilter(window.app);
      expect(filter("ai/memory/note.md")).toBe(false);
      expect(filter("copilot/copilot-conversations/chat.md")).toBe(false);
      expect(filter("notes/idea.md")).toBe(true);
      expect(mockGetAbstractFileByPath).not.toHaveBeenCalledWith("ai/memory/note.md");
    });

    it("excludes root instruction files even with no user patterns configured", () => {
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
      expect(filter("mycopilot/note.md")).toBe(true);
    });

    it("applies path-only QA rules when a current-vault path is unresolved (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", () => {
      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "notes,[[Pinned]]",
        qaExclusions: "private,*.tmp,[[Secret]]",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      mockGetAbstractFileByPath.mockReturnValue(null);

      const filter = createCopilotPatternFilter(window.app);

      expect(filter("notes/idea.md")).toBe(true);
      expect(filter("archive/Pinned.md")).toBe(true);
      expect(filter("private/idea.md")).toBe(false);
      expect(filter("notes/draft.tmp")).toBe(false);
      expect(filter("notes/Secret.md")).toBe(false);
      expect(filter("archive/other.md")).toBe(false);
    });

    it("fails closed when unresolved paths require metadata QA rules (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", () => {
      mockGetAbstractFileByPath.mockReturnValue(null);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "#published",
        qaExclusions: "",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      expect(createCopilotPatternFilter(window.app)("notes/unknown.md")).toBe(false);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        qaInclusions: "",
        qaExclusions: "[private:true]",
        copilotFolder: "copilot",
        copilotRootHistory: ["copilot"],
      });
      expect(createCopilotPatternFilter(window.app)("notes/unknown.md")).toBe(false);
    });

    it("excludes differently-cased instruction files where the filesystem is case-insensitive", () => {
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
