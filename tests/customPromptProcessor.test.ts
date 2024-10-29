import { CustomPrompt, CustomPromptProcessor } from "@/services/customPromptProcessor";
import { CopilotSettings } from "@/settings/SettingsPage";
import { Notice, TFile, Vault } from "obsidian";
import { getFileContent, getNoteFileFromTitle, getNotesFromPath } from "@/helpers/noteHelper";
import { extractNoteTitles } from "@/helpers/promptHelpers";

// Mock Obsidian
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
}));

// Mock the utility functions
jest.mock("@/helpers/noteHelper", () => ({
  getNoteFileFromTitle: jest.fn(),
  getFileContent: jest.fn(),
  getFileName: jest.fn(),
  getNotesFromPath: jest.fn(),
  getNotesFromTags: jest.fn(),
}));

jest.mock("@/helpers/promptHelpers", () => ({
  extractNoteTitles: jest.fn().mockReturnValue([]),
  processVariableNameForNotePath: jest.fn(),
}));

describe("CustomPromptProcessor", () => {
  let processor: CustomPromptProcessor;
  let mockVault: Vault;
  let mockSettings: CopilotSettings;
  let mockActiveNote: TFile;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Create mock objects
    mockVault = {} as Vault;
    mockSettings = {} as CopilotSettings;
    mockActiveNote = {
      path: "path/to/active/note.md",
      basename: "Active Note",
    } as TFile;

    // Create an instance of CustomPromptProcessor with mocked dependencies
    processor = CustomPromptProcessor.getInstance(mockVault, mockSettings);
  });

  it("should add 1 context and selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable} and {}.",
    };
    const selectedText = "here is some selected text 12345";

    // Mock getFileContent to return content for {variable}
    (getFileContent as jest.Mock).mockResolvedValueOnce("here is the note content for note0");
    (getNotesFromPath as jest.Mock).mockResolvedValueOnce([mockActiveNote]);

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("This is a {variable} and {selectedText}.");
    expect(result).toContain("here is some selected text 12345");
    expect(result).toContain("here is the note content for note0");
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

    // Mock the extractVariablesFromPrompt method to simulate tag processing
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(['[{"name":"note","content":"Note content for #tag"}]']);

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("Notes related to {#tag} are:");
    expect(result).toContain('[{"name":"note","content":"Note content for #tag"}]');
  });

  it("should process multiple tag variables correctly", async () => {
    const customPrompt = "Notes related to {#tag1,#tag2,#tag3} are:";
    const selectedText = "";

    // Mock the extractVariablesFromPrompt method to simulate processing of multiple tags
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([
        '[{"name":"note1","content":"Note content for #tag1"},{"name":"note2","content":"Note content for #tag2"}]',
      ]);

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("Notes related to {#tag1,#tag2,#tag3} are:");
    expect(result).toContain(
      '[{"name":"note1","content":"Note content for #tag1"},{"name":"note2","content":"Note content for #tag2"}]'
    );
  });

  it("should process [[note title]] syntax correctly", async () => {
    const customPrompt = "Content of [[Test Note]] is important.";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteTitles as jest.Mock).mockReturnValue(["Test Note"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue({} as TFile);
    (getFileContent as jest.Mock).mockResolvedValue("Test note content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("Content of [[Test Note]] is important.");
    expect(result).toContain("[[Test Note]]:\n\nTest note content");
  });

  it("should process {[[note title]]} syntax correctly without duplication", async () => {
    const customPrompt = "Content of {[[Test Note]]} is important.";
    const selectedText = "";

    // Mock the necessary functions
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([JSON.stringify([{ name: "Test Note", content: "Test note content" }])]);
    (extractNoteTitles as jest.Mock).mockReturnValue(["Test Note"]);

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("Content of {[[Test Note]]} is important.");
    expect(result).toContain(
      '[[Test Note]]:\n\n[{"name":"Test Note","content":"Test note content"}]'
    );

    // Ensure the content is not duplicated
    const occurrences = (result.match(/Test note content/g) || []).length;
    expect(occurrences).toBe(1);

    // Verify that getNoteFileFromTitle was not called
    expect(getNoteFileFromTitle).not.toHaveBeenCalled();
  });

  it("should process both {[[note title]]} and [[note title]] syntax correctly", async () => {
    const customPrompt = "{[[Note1]]} content and [[Note2]] are both important.";
    const selectedText = "";

    // Mock the necessary functions
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([JSON.stringify([{ name: "Note1", content: "Note1 content" }])]);
    (extractNoteTitles as jest.Mock).mockReturnValue(["Note1", "Note2"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue({} as TFile);
    (getFileContent as jest.Mock).mockResolvedValue("Note2 content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("{[[Note1]]} content and [[Note2]] are both important.");
    expect(result).toContain('[[Note1]]:\n\n[{"name":"Note1","content":"Note1 content"}]');
    expect(result).toContain("[[Note2]]:\n\nNote2 content");

    // Ensure Note1 content is not duplicated
    const note1Occurrences = (result.match(/Note1 content/g) || []).length;
    expect(note1Occurrences).toBe(1);

    // Verify that getNoteFileFromTitle was called only for Note2
    expect(getNoteFileFromTitle).toHaveBeenCalledTimes(1);
    expect(getNoteFileFromTitle).toHaveBeenCalledWith(expect.anything(), "Note2");
  });

  it("should handle multiple occurrences of [[note title]] syntax", async () => {
    const customPrompt = "[[Note1]] is related to [[Note2]] and [[Note3]].";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteTitles as jest.Mock).mockReturnValue(["Note1", "Note2", "Note3"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue({} as TFile);
    (getFileContent as jest.Mock)
      .mockResolvedValueOnce("Note1 content")
      .mockResolvedValueOnce("Note2 content")
      .mockResolvedValueOnce("Note3 content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("[[Note1]] is related to [[Note2]] and [[Note3]].");
    expect(result).toContain("[[Note1]]:\n\nNote1 content");
    expect(result).toContain("[[Note2]]:\n\nNote2 content");
    expect(result).toContain("[[Note3]]:\n\nNote3 content");
  });

  it("should handle non-existent note titles gracefully", async () => {
    const customPrompt = "[[Non-existent Note]] should not cause errors.";
    const selectedText = "";

    // Mock the necessary functions
    (extractNoteTitles as jest.Mock).mockReturnValue(["Non-existent Note"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue(null);

    const result = await processor.processCustomPrompt(customPrompt, selectedText, mockActiveNote);

    expect(result).toContain("[[Non-existent Note]] should not cause errors.");
    expect(result).not.toContain("[[Non-existent Note]]:");
  });

  it("should process {activenote} only once when it appears multiple times", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is the active note: {activeNote}. And again: {activeNote}",
    };
    const selectedText = "";

    // Mock the extractVariablesFromPrompt method to simulate processing of {activeNote}
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([
        JSON.stringify([{ name: "Active Note", content: "Content of the active note" }]),
      ]);

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("This is the active note: {activeNote}. And again: {activeNote}");
    expect(result).toContain("Content of the active note");
    expect((result.match(/activeNote:/g) || []).length).toBe(1);
    expect(processor.extractVariablesFromPrompt).toHaveBeenCalledTimes(1);
  });

  it("should use active note content when {} is present and no selected text", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Summarize this: {}",
    };
    const selectedText = "";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("Summarize this: {selectedText}");
    expect(result).toContain("selectedText (entire active note):\n\n Content of the active note");
    expect(getFileContent).toHaveBeenCalledWith(mockActiveNote, mockVault);
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
      .mockResolvedValue([
        JSON.stringify([{ name: "Active Note", content: "Content of the active note" }]),
      ]);

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("Summarize this: {selectedText}. Additional info: {activeNote}");
    expect(result).toContain("selectedText (entire active note):\n\n Content of the active note");
    expect(result).not.toContain("activeNote:");
    expect((result.match(/Content of the active note/g) || []).length).toBe(1);
  });

  it("should handle {} when no active note or selected text is available", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Process this: {}",
    };
    const selectedText = "";

    const result = await processor.processCustomPrompt(doc.content, selectedText, undefined);

    expect(result).toContain("Process this: {selectedText}");
    expect(result).toContain("selectedText:\n\n (No selected text or active note available)");
  });

  it("should prioritize selected text over active note when both are available", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Analyze this: {}",
    };
    const selectedText = "This is the selected text";

    (getFileContent as jest.Mock).mockResolvedValue("Content of the active note");

    const result = await processor.processCustomPrompt(doc.content, selectedText, mockActiveNote);

    expect(result).toContain("Analyze this: {selectedText}");
    expect(result).toContain("selectedText:\n\n This is the selected text");
    expect(result).not.toContain("Content of the active note");
  });
});
