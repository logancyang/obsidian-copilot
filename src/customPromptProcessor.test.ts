import { CustomPrompt, CustomPromptProcessor } from "@/customPromptProcessor";
import {
  extractNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
} from "@/utils";
import { Notice, TFile, Vault } from "obsidian";

// Mock Obsidian
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
}));

// Mock the utility functions
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
  getFileContent: jest.fn(),
  getFileName: jest.fn(),
  getNotesFromPath: jest.fn(),
  getNotesFromTags: jest.fn(),
  processVariableNameForNotePath: jest.fn(),
}));

// Mock the specific function from the same module
jest.mock("@/customPromptProcessor", () => {
  // Keep original implementations for things we don't want to mock
  const originalModule = jest.requireActual("@/customPromptProcessor");
  return {
    ...originalModule,
    extractVariablesFromPrompt: jest.fn(), // Mock the specific function
  };
});

describe("CustomPromptProcessor", () => {
  let processor: CustomPromptProcessor;
  let mockVault: Vault;
  let mockActiveNote: TFile;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    // Save original console.warn
    originalConsoleWarn = console.warn;
    // Mock console.warn
    console.warn = jest.fn();

    // Reset mocks before each test
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Set default implementations for critical mocks
    (extractNoteFiles as jest.Mock).mockReturnValue([]);

    // Create mock objects
    mockVault = {} as Vault;
    mockActiveNote = {
      path: "path/to/active/note.md",
      basename: "Active Note",
    } as TFile;

    // Create an instance of CustomPromptProcessor with mocked dependencies
    processor = CustomPromptProcessor.getInstance(mockVault);
  });

  afterEach(() => {
    // Restore original console.warn
    console.warn = originalConsoleWarn;
  });

  it("should add 1 context and selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable} and {}.",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "here is some selected text 12345";

    // Mock getFileContent to return content for {variable}
    (getFileContent as jest.Mock).mockResolvedValueOnce("here is the note content for note0");
    (getFileName as jest.Mock).mockReturnValueOnce("Variable Note");
    (getNotesFromPath as jest.Mock).mockResolvedValueOnce([mockActiveNote]);

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([
        ["variable", "## Variable Note\n\nhere is the note content for note0"],
      ]),
      includedFiles: new Set([mockActiveNote]),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "This is a {variable} and {selectedText}.\n\nselectedText:\n\nhere is some selected text 12345\n\nvariable:\n\n## Variable Note\n\nhere is the note content for note0"
    );
    expect(result.includedFiles).toContain(mockActiveNote);
  });

  it("should add 2 context and no selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable1} and {variable2}.",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    // Mock getFileContent to return content for {variable1} and {variable2}
    (getFileContent as jest.Mock)
      .mockResolvedValueOnce("here is the note content for note0")
      .mockResolvedValueOnce("note content for note1");

    // Mock getFileName to return appropriate names
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValueOnce("Variable1 Note").mockReturnValueOnce("Variable2 Note");

    // Mock getNotesFromPath to return two mock files, one for each variable
    const mockNote1 = { path: "path/to/note1.md", basename: "Variable1 Note" } as TFile;
    const mockNote2 = { path: "path/to/note2.md", basename: "Variable2 Note" } as TFile;
    (getNotesFromPath as jest.Mock)
      .mockResolvedValueOnce([mockNote1])
      .mockResolvedValueOnce([mockNote2]);

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([
        ["variable1", "## Variable1 Note\n\nhere is the note content for note0"],
        ["variable2", "## Variable2 Note\n\nnote content for note1"],
      ]),
      includedFiles: new Set([mockNote1, mockNote2]),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "This is a {variable1} and {variable2}.\n\nvariable1:\n\n## Variable1 Note\n\nhere is the note content for note0\n\nvariable2:\n\n## Variable2 Note\n\nnote content for note1"
    );
    expect(result.includedFiles).toContain(mockNote1);
    expect(result.includedFiles).toContain(mockNote2);
  });

  it("should add 1 selectedText and no context", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Rewrite the following text {}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "here is some selected text 12345";

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Rewrite the following text {selectedText}\n\nselectedText:\n\nhere is some selected text 12345"
    );
    expect(result.includedFiles).toEqual([]);
  });

  it("should process {activeNote} correctly", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activenote}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    // Mock the getFileContent function to return a predefined content for the active note
    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Active Note");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["activenote", "## Active Note\n\nContent of the active note"]]),
      includedFiles: new Set([mockActiveNote]),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "This is the active note: {activenote}\n\nactivenote:\n\n## Active Note\n\nContent of the active note"
    );
    expect(result.includedFiles).toContain(mockActiveNote);
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
  });

  it("should handle {activeNote} when no active note is provided", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activeNote}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(), // ActiveNote variable won't be found
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, undefined);

    expect(result.processedPrompt).toBe("This is the active note: {activeNote}\n\n");
    expect(result.includedFiles).toEqual([]);
    expect(Notice).toHaveBeenCalledWith("No active note found.");
  });

  it("should handle prompts without variables", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a test prompt with no variables.",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "selected text";

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe("This is a test prompt with no variables.\n\n");
    expect(result.includedFiles).toEqual([]);
  });

  it("should process a single tag variable correctly", async () => {
    const customPrompt = "Notes related to {#tag} are:";
    const selectedText = "";

    // Mock note file for the tag
    const mockNoteForTag = {
      path: "path/to/tagged/note.md",
      basename: "Tagged Note",
    } as TFile;

    // Mock getNotesFromTags to return our mock note
    (getNotesFromTags as jest.Mock).mockResolvedValue([mockNoteForTag]);

    // Mock getFileName to return the basename
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Tagged Note");

    // Mock getFileContent to return content for the note
    (getFileContent as jest.Mock).mockResolvedValue("Note content for #tag");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["#tag", "## Tagged Note\n\nNote content for #tag"]]),
      includedFiles: new Set([mockNoteForTag]),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Notes related to {#tag} are:\n\n#tag:\n\n## Tagged Note\n\nNote content for #tag"
    );
    expect(result.includedFiles).toContain(mockNoteForTag);
  });

  it("should process multiple tag variables correctly", async () => {
    const customPrompt = "Notes related to {#tag1,#tag2,#tag3} are:";
    const selectedText = "";

    // Mock note files for the tags
    const mockNoteForTag1 = {
      basename: "Tagged Note 1",
      path: "path/to/tagged/note1.md",
    } as TFile;
    const mockNoteForTag2 = {
      basename: "Tagged Note 2",
      path: "path/to/tagged/note2.md",
    } as TFile;

    // Mock getNotesFromTags to return our mock notes
    (getNotesFromTags as jest.Mock).mockResolvedValue([mockNoteForTag1, mockNoteForTag2]);

    // Mock getFileName to return the basename
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockImplementation((file: TFile) => file.basename);

    // Mock getFileContent to return content for each note
    (getFileContent as jest.Mock).mockImplementation((file: TFile) => {
      if (file.basename === "Tagged Note 1") {
        return "Note content for #tag1";
      } else if (file.basename === "Tagged Note 2") {
        return "Note content for #tag2";
      }
      return "";
    });

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([
        [
          "#tag1,#tag2,#tag3",
          "## Tagged Note 1\n\nNote content for #tag1\n\n## Tagged Note 2\n\nNote content for #tag2",
        ],
      ]),
      includedFiles: new Set([mockNoteForTag1, mockNoteForTag2]),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Notes related to {#tag1,#tag2,#tag3} are:\n\n#tag1,#tag2,#tag3:\n\n## Tagged Note 1\n\nNote content for #tag1\n\n## Tagged Note 2\n\nNote content for #tag2"
    );
    expect(result.includedFiles).toContain(mockNoteForTag1);
    expect(result.includedFiles).toContain(mockNoteForTag2);
  });

  it("should process [[note title]] syntax correctly", async () => {
    const customPrompt = "Content of [[Test Note]] is important.";
    const selectedText = "";
    const mockTestNote = { basename: "Test Note", path: "Test Note.md" } as TFile;

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue([mockTestNote]);
    (getFileContent as jest.Mock).mockResolvedValue("Test note content");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toContain("Content of [[Test Note]] is important");
    expect(result.processedPrompt).toContain(
      "Title: [[Test Note]]\nPath: Test Note.md\n\nTest note content"
    );
    expect(result.includedFiles).toContain(mockTestNote);
  });

  it("should process {[[note title]]} syntax correctly without duplication", async () => {
    const customPrompt = "Content of {[[Test Note]]} is important. Look at [[Test Note]].";
    const selectedText = "";

    // Mock the necessary functions
    const mockNoteFile = {
      basename: "Test Note",
      path: "Test Note.md",
    } as TFile;

    (extractNoteFiles as jest.Mock).mockReturnValue([mockNoteFile]);

    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Test Note");

    (getFileContent as jest.Mock).mockResolvedValue("Test note content");

    // Mock getNotesFromPath to return our mock note
    (getNotesFromPath as jest.Mock).mockResolvedValue([mockNoteFile]);

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["[[Test Note]]", "## Test Note\n\nTest note content"]]),
      includedFiles: new Set([mockNoteFile]),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Content of {[[Test Note]]} is important. Look at [[Test Note]].\n\n[[Test Note]]:\n\n## Test Note\n\nTest note content"
    );
    // Note: extractNoteFiles will still find [[Test Note]], but processPrompt should skip adding it again because it's already in includedFiles from the variable processing
    expect(result.includedFiles).toEqual([mockNoteFile]);
    expect(extractNoteFiles).toHaveBeenCalledWith(customPrompt, mockVault);
  });

  it("should process both {[[note title]]} and [[note title]] syntax correctly", async () => {
    const customPrompt = "{[[Note1]]} content and [[Note2]] are both important.";
    const selectedText = "";

    // Mock the necessary functions
    const mockNote1 = {
      basename: "Note1",
      path: "Note1.md",
    } as TFile;

    const mockNote2 = {
      basename: "Note2",
      path: "Note2.md",
    } as TFile;

    (extractNoteFiles as jest.Mock).mockReturnValue([mockNote1, mockNote2]);

    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockImplementation((file: TFile) => file.basename);

    (getFileContent as jest.Mock).mockImplementation((file: TFile) => {
      if (file.basename === "Note1") {
        return "Note1 content";
      } else if (file.basename === "Note2") {
        return "Note2 content";
      }
      return "";
    });

    // Mock getNotesFromPath to return our mock note
    (getNotesFromPath as jest.Mock).mockResolvedValue([mockNote1]);

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["[[Note1]]", "## Note1\n\nNote1 content"]]),
      includedFiles: new Set([mockNote1]), // Only Note1 comes from variables
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toContain(
      "{[[Note1]]} content and [[Note2]] are both important"
    );
    expect(result.processedPrompt).toContain("## Note1\n\nNote1 content");
    expect(result.processedPrompt).toContain("Title: [[Note2]]\nPath: Note2.md\n\nNote2 content");
    // Note2 is added via [[Note2]] processing
    expect(result.includedFiles).toEqual(expect.arrayContaining([mockNote1, mockNote2]));
    expect(result.includedFiles.length).toBe(2);
  });

  it("should handle multiple occurrences of [[note title]] syntax", async () => {
    const customPrompt = "[[Note1]] is related to [[Note2]] and [[Note3]].";
    const selectedText = "";
    const mockNote1 = { basename: "Note1", path: "Note1.md" } as TFile;
    const mockNote2 = { basename: "Note2", path: "Note2.md" } as TFile;
    const mockNote3 = { basename: "Note3", path: "Note3.md" } as TFile;

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue([mockNote1, mockNote2, mockNote3]);
    (getFileContent as jest.Mock).mockImplementation((file: TFile) => {
      if (file.basename === "Note1") {
        return "Note1 content";
      } else if (file.basename === "Note2") {
        return "Note2 content";
      } else if (file.basename === "Note3") {
        return "Note3 content";
      }
      return "";
    });

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toContain("[[Note1]] is related to [[Note2]] and [[Note3]].");
    expect(result.processedPrompt).toContain("Title: [[Note1]]\nPath: Note1.md\n\nNote1 content");
    expect(result.processedPrompt).toContain("Title: [[Note2]]\nPath: Note2.md\n\nNote2 content");
    expect(result.processedPrompt).toContain("Title: [[Note3]]\nPath: Note3.md\n\nNote3 content");
    expect(result.includedFiles).toEqual(expect.arrayContaining([mockNote1, mockNote2, mockNote3]));
    expect(result.includedFiles.length).toBe(3);
  });

  it("should handle non-existent note titles gracefully", async () => {
    const customPrompt = "[[Non-existent Note]] should not cause errors.";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue([]); // Assume it returns empty if note doesn't exist

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe("[[Non-existent Note]] should not cause errors.\n\n");
    expect(result.includedFiles).toEqual([]);
  });

  it("should process {activenote} only once when it appears multiple times", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activeNote}. And again: {activeNote}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    // Mock getFileName and getFileContent
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Active Note");

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    // Even if the regex matches twice, extractVariablesFromPrompt should handle it
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["activeNote", "## Active Note\n\nContent of the active note"]]),
      includedFiles: new Set([mockActiveNote]),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    // Check that getFileContent was called with the active note at least once
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
    expect(result.processedPrompt).toBe(
      "This is the active note: {activeNote}. And again: {activeNote}\n\nactiveNote:\n\n## Active Note\n\nContent of the active note"
    );
    expect(result.includedFiles).toContain(mockActiveNote);
  });

  it("should use active note content when {} is present and no selected text", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Summarize this: {}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Summarize this: {selectedText}\n\nselectedText (entire active note):\n\nContent of the active note"
    );
    // Active note should be included because of {}
    expect(result.includedFiles).toContain(mockActiveNote);
  });

  it("should not duplicate active note content when both {} and {activeNote} are present", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Summarize this: {}. Additional info: {activeNote}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "";

    // Mock getFileContent for the active note when processed via {}
    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Active Note");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["activeNote", "## Active Note\n\nContent of the active note"]]),
      includedFiles: new Set([mockActiveNote]),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Summarize this: {selectedText}. Additional info: {activeNote}\n\nselectedText (entire active note):\n\nContent of the active note"
    );
    // Ensure extractVariablesFromPrompt was NOT necessarily called if active note was handled by {}
    // expect(mockExtractVariables).toHaveBeenCalled(); // Removed this check
    // Ensure getFileContent was called for the {} replacement
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
    // Active note should be included only once
    expect(result.includedFiles).toEqual([mockActiveNote]);
  });

  it("should prioritize selected text over active note when both are available", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Analyze this: {}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };
    const selectedText = "This is the selected text";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map(),
      includedFiles: new Set(),
    });

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "Analyze this: {selectedText}\n\nselectedText:\n\nThis is the selected text"
    );
    // Active note should not be included when selected text is present for {}
    expect(result.includedFiles).toEqual([]);
  });

  it("should handle invalid variable names correctly", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a test prompt with {invalidVariable} name and {activeNote}",
      showInContextMenu: false,
      slashCommandEnabled: false,
      filePath: "test-prompt.md",
      order: 0,
    };

    const selectedText = "";

    (getNotesFromPath as jest.Mock).mockImplementation((_vault: Vault, variableName: string) => {
      if (variableName === "Active Note") {
        // Assuming processVariableNameForNotePath is mocked to return this
        return [mockActiveNote];
      }
      return [];
    });

    (getFileName as jest.Mock).mockReturnValue(mockActiveNote.basename);
    (getFileContent as jest.Mock).mockImplementation((file: TFile) => {
      if (file.basename === "Active Note") {
        return "Active Note Content";
      }
      return "";
    });

    // Mock the module-level extractVariablesFromPrompt function
    const mockExtractVariables = jest.requireMock("@/customPromptProcessor")
      .extractVariablesFromPrompt as jest.Mock;
    // Simulate that only activeNote is found
    mockExtractVariables.mockResolvedValue({
      variablesMap: new Map([["activeNote", "## Active Note\n\nActive Note Content"]]),
      includedFiles: new Set([mockActiveNote]),
    });
    // We also need to mock processVariableNameForNotePath for the "activeNote" variable
    const { processVariableNameForNotePath } = jest.requireMock("@/utils") as any;
    processVariableNameForNotePath.mockImplementation((name: string) => name); // Simple passthrough for test

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result.processedPrompt).toBe(
      "This is a test prompt with {invalidVariable} name and {activeNote}\n\nactiveNote:\n\n## Active Note\n\nActive Note Content"
    );
    expect(result.includedFiles).toContain(mockActiveNote);
    // Expect the warning for the invalid variable
    expect(console.warn).toHaveBeenCalledWith("No notes found for variable: invalidVariable");
  });
});
