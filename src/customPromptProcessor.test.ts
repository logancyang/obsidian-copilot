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

describe("CustomPromptProcessor", () => {
  let processor: CustomPromptProcessor;
  let mockVault: Vault;
  let mockActiveNote: TFile;

  beforeEach(() => {
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

  it("should add 1 context and selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable} and {}.",
    };
    const selectedText = "here is some selected text 12345";

    // Mock getFileContent to return content for {variable}
    (getFileContent as jest.Mock).mockResolvedValueOnce("here is the note content for note0");
    (getFileName as jest.Mock).mockReturnValueOnce("Variable Note");
    (getNotesFromPath as jest.Mock).mockResolvedValueOnce([mockActiveNote]);

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe(
      "This is a {variable} and {selectedText}.\n\nselectedText:\n\nhere is some selected text 12345\n\nvariable:\n\n## Variable Note\n\nhere is the note content for note0"
    );
  });

  it("should add 2 context and no selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable1} and {variable2}.",
    };
    const selectedText = "";

    // Mock getFileContent to return content for {variable1} and {variable2}
    (getFileContent as jest.Mock)
      .mockResolvedValueOnce("here is the note content for note0")
      .mockResolvedValueOnce("note content for note1");

    // Mock getNotesFromPath to return an array with a single mock file
    (getNotesFromPath as jest.Mock).mockResolvedValue([mockActiveNote]);

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("This is a {variable1} and {variable2}.");
    expect(result).toContain("here is the note content for note0");
    expect(result).toContain("note content for note1");
  });

  it("should add 1 selectedText and no context", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Rewrite the following text {}",
    };
    const selectedText = "here is some selected text 12345";

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("Rewrite the following text {selectedText}");
    expect(result).toContain("here is some selected text 12345");
  });

  it("should process {activeNote} correctly", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activenote}",
    };
    const selectedText = "";

    // Mock the getFileContent function to return a predefined content for the active note
    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("This is the active note: {activenote}");
    expect(result).toContain("Content of the active note");
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
  });

  it("should handle {activeNote} when no active note is provided", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activeNote}",
    };
    const selectedText = "";

    const result = await processor.processCustomPrompt(doc.content, selectedText, undefined);

    expect(result).toContain("This is the active note: {activeNote}");
    expect(result).not.toContain("Content of the active note");
    expect(getFileContent).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith("No active note found.");
  });

  it("should handle prompts without variables", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a test prompt with no variables.",
    };
    const selectedText = "selected text";

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe("This is a test prompt with no variables.\n\n");
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
    (getNotesFromTags as jest.Mock).mockReturnValue([mockNoteForTag]);

    // Mock getFileName to return the basename
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Tagged Note");

    // Mock getFileContent to return content for the note
    (getFileContent as jest.Mock).mockResolvedValue("Note content for #tag");

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain(
      "Notes related to {#tag} are:\n\n\n\n#tag:\n\n## Tagged Note\n\nNote content for #tag"
    );
  });

  it("should process multiple tag variables correctly", async () => {
    const customPrompt = "Notes related to {#tag1,#tag2,#tag3} are:";
    const selectedText = "";

    // Mock note files for the tags
    const mockNoteForTag1 = {
      path: "path/to/tagged/note1.md",
      basename: "Tagged Note 1",
    } as TFile;
    const mockNoteForTag2 = {
      path: "path/to/tagged/note2.md",
      basename: "Tagged Note 2",
    } as TFile;

    // Mock getNotesFromTags to return our mock notes
    (getNotesFromTags as jest.Mock).mockReturnValue([mockNoteForTag1, mockNoteForTag2]);

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

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe(
      "Notes related to {#tag1,#tag2,#tag3} are:\n\n\n\n#tag1,#tag2,#tag3:\n\n## Tagged Note 1\n\nNote content for #tag1\n\n## Tagged Note 2\n\nNote content for #tag2"
    );
  });

  it("should process [[note title]] syntax correctly", async () => {
    const customPrompt = "Content of [[Test Note]] is important.";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue([
      { basename: "Test Note", path: "Test Note.md" },
    ]);
    (getFileContent as jest.Mock).mockResolvedValue("Test note content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe(
      "Content of [[Test Note]] is important.\n\n\n\nTitle: [[Test Note]]\nPath: Test Note.md\n\nTest note content"
    );
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

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe(
      "Content of {[[Test Note]]} is important. Look at [[Test Note]].\n\n\n\n[[Test Note]]:\n\n## Test Note\n\nTest note content"
    );
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

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe(
      "{[[Note1]]} content and [[Note2]] are both important.\n\n\n\n[[Note1]]:\n\n## Note1\n\nNote1 content\n\nTitle: [[Note2]]\nPath: Note2.md\n\nNote2 content"
    );
  });

  it("should handle multiple occurrences of [[note title]] syntax", async () => {
    const customPrompt = "[[Note1]] is related to [[Note2]] and [[Note3]].";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue([
      { basename: "Note1", path: "Note1.md" },
      { basename: "Note2", path: "Note2.md" },
      { basename: "Note3", path: "Note3.md" },
    ]);
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

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe(
      "[[Note1]] is related to [[Note2]] and [[Note3]].\n\n\n\nTitle: [[Note1]]\nPath: Note1.md\n\nNote1 content\n\nTitle: [[Note2]]\nPath: Note2.md\n\nNote2 content\n\nTitle: [[Note3]]\nPath: Note3.md\n\nNote3 content"
    );
  });

  it("should handle non-existent note titles gracefully", async () => {
    const customPrompt = "[[Non-existent Note]] should not cause errors.";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteFiles as jest.Mock).mockReturnValue(["Non-existent Note"]);

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toBe("[[Non-existent Note]] should not cause errors.\n\n");
  });

  it("should process {activenote} only once when it appears multiple times", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activeNote}. And again: {activeNote}",
    };
    const selectedText = "";

    // Mock getFileName and getFileContent
    const { getFileName } = jest.requireMock("@/utils") as any;
    getFileName.mockReturnValue("Active Note");

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    // Check that getFileContent was called with the active note at least once
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
    expect(result).toBe(
      "This is the active note: {activeNote}. And again: {activeNote}\n\n\n\nactiveNote:\n\n## Active Note\n\nContent of the active note"
    );
  });

  it("should use active note content when {} is present and no selected text", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Summarize this: {}",
    };
    const selectedText = "";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe(
      "Summarize this: {selectedText}\n\nselectedText (entire active note):\n\nContent of the active note"
    );
  });

  it("should not duplicate active note content when both {} and {activeNote} are present", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Summarize this: {}. Additional info: {activeNote}",
    };
    const selectedText = "";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(new Map([["Active Note", "Content of the active note"]]));

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe(
      "Summarize this: {selectedText}. Additional info: {activeNote}\n\nselectedText (entire active note):\n\nContent of the active note"
    );
  });

  it("should prioritize selected text over active note when both are available", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Analyze this: {}",
    };
    const selectedText = "This is the selected text";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe(
      "Analyze this: {selectedText}\n\nselectedText:\n\nThis is the selected text"
    );
  });

  it("should handle invalid variable names correctly", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a test prompt with {invalidVariable} name and {activeNote}",
    };

    const selectedText = "";

    (getNotesFromPath as jest.Mock).mockImplementation((_vault: Vault, variableName: string) => {
      if (variableName === "Active Note") {
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

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toBe(
      "This is a test prompt with {invalidVariable} name and {activeNote}\n\n\n\nactiveNote:\n\n## Active Note\n\nActive Note Content"
    );
  });
});
