import { TFile } from "obsidian";
import {
  createPatternSettingsValue,
  getFilePattern,
  shouldIndexFile,
  PatternCategory,
} from "@/search/searchUtils";

// Mock dependencies
jest.mock("obsidian", () => ({
  TFile: class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string = "") {
      this.path = path;
      const parts = path.split("/");
      const filename = parts[parts.length - 1];
      this.basename = filename.replace(/\.[^/.]+$/, "");
      this.extension = filename.split(".").pop() || "";
    }
  },
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  shouldIndexFile: jest.fn(),
  getFilePattern: jest.fn(),
  createPatternSettingsValue: jest.fn(),
  categorizePatterns: jest.fn(),
  getDecodedPatterns: jest.fn(),
}));

// Mock types and interfaces
interface GroupItem {
  id: string;
  name: string;
  isIgnored?: boolean;
}

interface GroupListItem {
  tags: Record<string, Array<GroupItem>>;
  folders: Record<string, Array<GroupItem>>;
  extensions: Record<string, Array<GroupItem>>;
  notes: Array<GroupItem>;
}

interface IgnoreItems {
  files: Set<TFile>;
}

// Test helper functions
const createTestFile = (path: string): TFile => {
  const file = new TFile();
  file.path = path;
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  file.basename = filename.replace(/\.[^/.]+$/, "");
  file.extension = filename.split(".").pop() || "";
  return file;
};

const createMockPatternCategory = (overrides: Partial<PatternCategory> = {}): PatternCategory => ({
  tagPatterns: [],
  folderPatterns: [],
  extensionPatterns: [],
  notePatterns: [],
  ...overrides,
});

// Implementation of the functions to test
const createAndPopulateGroupList = (
  appFiles: TFile[],
  inclusionPatterns: PatternCategory | null,
  exclusionPatterns: PatternCategory | null
): GroupListItem => {
  const projectAllFiles = appFiles.filter((file) =>
    shouldIndexFile(file, inclusionPatterns, exclusionPatterns)
  );

  // Initialize groups
  const tags: Record<string, Array<GroupItem>> = {};
  const folders: Record<string, Array<GroupItem>> = {};
  const extensions: Record<string, Array<GroupItem>> = {};
  const notes: Array<GroupItem> = [];

  (inclusionPatterns?.tagPatterns ?? []).forEach((tag) => {
    tags[tag] = [];
  });
  (inclusionPatterns?.folderPatterns ?? []).forEach((folder) => {
    folders[folder] = [];
  });
  (inclusionPatterns?.extensionPatterns ?? []).forEach((extension) => {
    extensions[extension] = [];
  });

  // Populate with matching files
  projectAllFiles.forEach((file) => {
    const groupItem: GroupItem = {
      id: file.path,
      name: file.basename,
    };

    // Add to notes array
    notes.push(groupItem);

    // Add to appropriate groups based on patterns
    (inclusionPatterns?.tagPatterns ?? []).forEach((tag) => {
      if (tags[tag]) {
        tags[tag].push(groupItem);
      }
    });

    (inclusionPatterns?.folderPatterns ?? []).forEach((folder) => {
      if (folders[folder] && file.path.includes(folder)) {
        folders[folder].push(groupItem);
      }
    });

    (inclusionPatterns?.extensionPatterns ?? []).forEach((extension) => {
      if (extensions[extension] && file.extension === extension.replace("*.", "")) {
        extensions[extension].push(groupItem);
      }
    });
  });

  return { tags, folders, extensions, notes };
};

const convertGroupListToInclusions = (list: GroupListItem, appFiles: TFile[]): string => {
  const tagPatterns = Object.keys(list.tags);
  const folderPatterns = Object.keys(list.folders);
  const extensionPatterns = Object.keys(list.extensions);
  const notePatterns = list.notes
    .map((note) => {
      const file = appFiles.find((file) => file.path === note.id);
      if (file) {
        return getFilePattern(file);
      }
    })
    .filter(Boolean) as string[];

  return createPatternSettingsValue({
    tagPatterns,
    folderPatterns,
    extensionPatterns,
    notePatterns,
  });
};

const convertDeletedItemsToExclusions = (items: IgnoreItems): string => {
  const notePatterns = Array.from(items.files).map((file) => getFilePattern(file));
  return createPatternSettingsValue({ notePatterns }) || "";
};

describe("Context Manage Modal Functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    (shouldIndexFile as jest.Mock).mockReturnValue(true);
    (getFilePattern as jest.Mock).mockImplementation((file: TFile) => `[[${file.basename}]]`);
    (createPatternSettingsValue as jest.Mock).mockImplementation(
      ({ tagPatterns = [], folderPatterns = [], extensionPatterns = [], notePatterns = [] }) => {
        const patterns = [...tagPatterns, ...folderPatterns, ...extensionPatterns, ...notePatterns];
        return patterns.join(",");
      }
    );
  });

  describe("createAndPopulateGroupList", () => {
    it("Should create empty GroupList when there are no files", () => {
      const result = createAndPopulateGroupList([], null, null);

      expect(result).toEqual({
        tags: {},
        folders: {},
        extensions: {},
        notes: [],
      });
    });

    it("Should correctly filter files based on inclusion and exclusion patterns", () => {
      const files = [
        createTestFile("test1.md"),
        createTestFile("test2.pdf"),
        createTestFile("test3.txt"),
      ];

      (shouldIndexFile as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const inclusionPatterns = createMockPatternCategory();
      const exclusionPatterns = createMockPatternCategory();

      const result = createAndPopulateGroupList(files, inclusionPatterns, exclusionPatterns);

      expect(shouldIndexFile).toHaveBeenCalledTimes(3);
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].id).toBe("test1.md");
      expect(result.notes[1].id).toBe("test3.txt");
    });

    it("Should initialize groups based on inclusion patterns", () => {
      const files = [createTestFile("test.md")];
      const inclusionPatterns = createMockPatternCategory({
        tagPatterns: ["#important", "#work"],
        folderPatterns: ["docs", "projects"],
        extensionPatterns: ["*.md", "*.pdf"],
      });

      const result = createAndPopulateGroupList(files, inclusionPatterns, null);

      expect(Object.keys(result.tags)).toEqual(["#important", "#work"]);
      expect(Object.keys(result.folders)).toEqual(["docs", "projects"]);
      expect(Object.keys(result.extensions)).toEqual(["*.md", "*.pdf"]);
    });

    it("Should add files to appropriate groups", () => {
      const files = [createTestFile("docs/test.md"), createTestFile("projects/work.pdf")];

      const inclusionPatterns = createMockPatternCategory({
        folderPatterns: ["docs", "projects"],
        extensionPatterns: ["*.md", "*.pdf"],
      });

      const result = createAndPopulateGroupList(files, inclusionPatterns, null);

      expect(result.folders["docs"]).toHaveLength(1);
      expect(result.folders["docs"][0].name).toBe("test");
      expect(result.folders["projects"]).toHaveLength(1);
      expect(result.folders["projects"][0].name).toBe("work");
    });

    it("Should handle duplicate patterns", () => {
      const files = [createTestFile("test.md")];
      const inclusionPatterns = createMockPatternCategory({
        tagPatterns: ["#tag", "#tag", "#tag"],
        folderPatterns: ["folder", "folder"],
      });

      const result = createAndPopulateGroupList(files, inclusionPatterns, null);

      expect(Object.keys(result.tags)).toEqual(["#tag"]);
      expect(Object.keys(result.folders)).toEqual(["folder"]);
    });
  });

  describe("convertGroupListToInclusions", () => {
    it("Should convert empty GroupList to empty string", () => {
      const emptyGroupList: GroupListItem = {
        tags: {},
        folders: {},
        extensions: {},
        notes: [],
      };

      const result = convertGroupListToInclusions(emptyGroupList, []);

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        tagPatterns: [],
        folderPatterns: [],
        extensionPatterns: [],
        notePatterns: [],
      });
      expect(result).toBe("");
    });

    it("Should correctly extract all pattern types", () => {
      const groupList: GroupListItem = {
        tags: { "#important": [], "#work": [] },
        folders: { docs: [], projects: [] },
        extensions: { "*.md": [], "*.pdf": [] },
        notes: [
          { id: "note1.md", name: "note1" },
          { id: "note2.md", name: "note2" },
        ],
      };

      const appFiles = [createTestFile("note1.md"), createTestFile("note2.md")];

      convertGroupListToInclusions(groupList, appFiles);

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        tagPatterns: ["#important", "#work"],
        folderPatterns: ["docs", "projects"],
        extensionPatterns: ["*.md", "*.pdf"],
        notePatterns: ["[[note1]]", "[[note2]]"],
      });
    });

    it("Should handle notes without corresponding files", () => {
      const groupList: GroupListItem = {
        tags: {},
        folders: {},
        extensions: {},
        notes: [
          { id: "missing.md", name: "missing" },
          { id: "existing.md", name: "existing" },
        ],
      };

      const appFiles = [createTestFile("existing.md")];

      convertGroupListToInclusions(groupList, appFiles);

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        tagPatterns: [],
        folderPatterns: [],
        extensionPatterns: [],
        notePatterns: ["[[existing]]"],
      });
    });
  });

  describe("convertDeletedItemsToExclusions", () => {
    it("Should convert empty IgnoreItems to empty string", () => {
      const emptyIgnoreItems: IgnoreItems = {
        files: new Set(),
      };

      const result = convertDeletedItemsToExclusions(emptyIgnoreItems);

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        notePatterns: [],
      });
      expect(result).toBe("");
    });

    it("Should correctly convert ignored files to exclusion patterns", () => {
      const file1 = createTestFile("ignore1.md");
      const file2 = createTestFile("ignore2.pdf");

      const ignoreItems: IgnoreItems = {
        files: new Set([file1, file2]),
      };

      convertDeletedItemsToExclusions(ignoreItems);

      expect(getFilePattern).toHaveBeenCalledWith(file1);
      expect(getFilePattern).toHaveBeenCalledWith(file2);
      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        notePatterns: ["[[ignore1]]", "[[ignore2]]"],
      });
    });

    it("Should handle a single ignored file", () => {
      const file = createTestFile("single.md");
      const ignoreItems: IgnoreItems = {
        files: new Set([file]),
      };

      convertDeletedItemsToExclusions(ignoreItems);

      expect(getFilePattern).toHaveBeenCalledWith(file);
      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        notePatterns: ["[[single]]"],
      });
    });

    it("Should handle case when createPatternSettingsValue returns undefined", () => {
      (createPatternSettingsValue as jest.Mock).mockReturnValueOnce(undefined);

      const file = createTestFile("test.md");
      const ignoreItems: IgnoreItems = {
        files: new Set([file]),
      };

      const result = convertDeletedItemsToExclusions(ignoreItems);

      expect(result).toBe("");
    });
  });

  // Boundary conditions and error handling tests
  describe("Boundary Condition Tests", () => {
    describe("createAndPopulateGroupList", () => {
      it("Should handle null inclusion patterns", () => {
        const files = [createTestFile("test.md")];
        const result = createAndPopulateGroupList(files, null, null);

        expect(result.tags).toEqual({});
        expect(result.folders).toEqual({});
        expect(result.extensions).toEqual({});
        expect(result.notes).toHaveLength(1);
      });

      it("Should handle file paths with special characters", () => {
        const files = [
          createTestFile("folder with spaces/file-with-dashes.md"),
          createTestFile("中文文件夹/中文文件.md"),
          createTestFile("folder/file@#$%.md"),
        ];

        const result = createAndPopulateGroupList(files, null, null);

        expect(result.notes).toHaveLength(3);
        expect(result.notes[0].name).toBe("file-with-dashes");
        expect(result.notes[1].name).toBe("中文文件");
        expect(result.notes[2].name).toBe("file@#$%");
      });
    });

    describe("convertGroupListToInclusions", () => {
      it("Should handle large number of patterns", () => {
        const tags: Record<string, Array<GroupItem>> = {};
        const folders: Record<string, Array<GroupItem>> = {};
        const extensions: Record<string, Array<GroupItem>> = {};

        // Create many patterns
        for (let i = 0; i < 100; i++) {
          tags[`#tag${i}`] = [];
          folders[`folder${i}`] = [];
          extensions[`*.ext${i}`] = [];
        }

        const groupList: GroupListItem = { tags, folders, extensions, notes: [] };
        convertGroupListToInclusions(groupList, []);

        expect(createPatternSettingsValue).toHaveBeenCalledWith({
          tagPatterns: expect.arrayContaining([`#tag0`, `#tag99`]),
          folderPatterns: expect.arrayContaining([`folder0`, `folder99`]),
          extensionPatterns: expect.arrayContaining([`*.ext0`, `*.ext99`]),
          notePatterns: [],
        });
      });

      it("Should handle invalid file paths in notes", () => {
        const groupList: GroupListItem = {
          tags: {},
          folders: {},
          extensions: {},
          notes: [
            { id: "", name: "" },
            { id: "   ", name: "   " },
            { id: "valid.md", name: "valid" },
          ],
        };

        const appFiles = [createTestFile("valid.md")];
        convertGroupListToInclusions(groupList, appFiles);

        expect(createPatternSettingsValue).toHaveBeenCalledWith({
          tagPatterns: [],
          folderPatterns: [],
          extensionPatterns: [],
          notePatterns: ["[[valid]]"],
        });
      });
    });

    describe("convertDeletedItemsToExclusions", () => {
      it("Should handle large number of ignored files", () => {
        const files = new Set<TFile>();
        for (let i = 0; i < 1000; i++) {
          files.add(createTestFile(`file${i}.md`));
        }

        const ignoreItems: IgnoreItems = { files };
        convertDeletedItemsToExclusions(ignoreItems);

        expect(getFilePattern).toHaveBeenCalledTimes(1000);
        expect(createPatternSettingsValue).toHaveBeenCalledWith({
          notePatterns: expect.arrayContaining(["[[file0]]", "[[file999]]"]),
        });
      });

      it("Should handle filenames with special characters", () => {
        const files = [
          createTestFile("file with spaces.md"),
          createTestFile("file-with-dashes.md"),
          createTestFile("file_with_underscores.md"),
          createTestFile("file@#$%.md"),
        ];

        const ignoreItems: IgnoreItems = { files: new Set(files) };
        convertDeletedItemsToExclusions(ignoreItems);

        expect(getFilePattern).toHaveBeenCalledTimes(4);
        files.forEach((file) => {
          expect(getFilePattern).toHaveBeenCalledWith(file);
        });
      });
    });
  });

  // Integration tests
  describe("Integration Tests", () => {
    it("Should correctly handle the complete workflow", () => {
      // 1. Create initial file list
      const appFiles = [
        createTestFile("docs/readme.md"),
        createTestFile("src/main.ts"),
        createTestFile("tests/test.spec.ts"),
        createTestFile("config.json"),
      ];

      // 2. Set inclusion patterns
      const inclusionPatterns = createMockPatternCategory({
        folderPatterns: ["docs", "src"],
        extensionPatterns: ["*.md", "*.ts"],
      });

      // 3. Create GroupList
      const groupList = createAndPopulateGroupList(appFiles, inclusionPatterns, null);

      // 4. Convert to inclusions
      const inclusions = convertGroupListToInclusions(groupList, appFiles);

      // 5. Create ignore items and convert to exclusions
      const ignoreItems: IgnoreItems = {
        files: new Set([createTestFile("config.json")]),
      };
      const exclusions = convertDeletedItemsToExclusions(ignoreItems);

      // Verify results
      expect(groupList.folders).toHaveProperty("docs");
      expect(groupList.folders).toHaveProperty("src");
      expect(Object.prototype.hasOwnProperty.call(groupList.extensions, "*.md")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(groupList.extensions, "*.ts")).toBe(true);

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        tagPatterns: [],
        folderPatterns: ["docs", "src"],
        extensionPatterns: ["*.md", "*.ts"],
        notePatterns: expect.any(Array),
      });

      expect(createPatternSettingsValue).toHaveBeenCalledWith({
        notePatterns: ["[[config]]"],
      });

      // Verify inclusions and exclusions variables
      // Since createPatternSettingsValue is mocked to return all patterns as comma-separated list
      expect(inclusions).toContain("docs");
      expect(inclusions).toContain("src");
      expect(inclusions).toContain("*.md");
      expect(inclusions).toContain("*.ts");

      expect(exclusions).toBe("[[config]]");
    });
  });
});
