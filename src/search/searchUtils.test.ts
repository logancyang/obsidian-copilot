import { TFile } from "obsidian";
import { shouldIndexFile } from "./searchUtils";
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
  isPathInList: jest.requireActual("@/utils").isPathInList,
  stripHash: jest.requireActual("@/utils").stripHash,
}));

describe("shouldIndexFile", () => {
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
    const exclusions = ["private"];
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
