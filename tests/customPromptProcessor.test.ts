import { CustomPrompt, CustomPromptProcessor } from "@/customPromptProcessor";
import { CopilotSettings } from "@/settings/SettingsPage";
import { extractNoteTitles, getFileContent, getNoteFileFromTitle } from "@/utils";
import { TFile } from "obsidian";

// Mock the utility functions
jest.mock("@/utils", () => ({
  extractNoteTitles: jest.fn().mockReturnValue([]),
  getNoteFileFromTitle: jest.fn(),
  getFileContent: jest.fn(),
}));

describe("CustomPromptProcessor", () => {
  let processor: CustomPromptProcessor;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Create an instance of CustomPromptProcessor with mocked dependencies
    processor = CustomPromptProcessor.getInstance({} as any, {} as CopilotSettings);
  });

  it("should add 1 context and selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable} and {}.",
    };
    const selectedText = "here is some selected text 12345";

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(["here is the note content for note0"]);

    const result = await processor.processCustomPrompt(doc.content, selectedText);

    expect(result).toContain("This is a {variable} and {selectedText}.");
    expect(result).toContain("here is some selected text 12345");
    expect(result).toContain("here is the note content for note0");
  });

  it("should add 2 context and no selectedText", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a {variable} and {var2}.",
    };
    const selectedText = "here is some selected text 12345";

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(["here is the note content for note0", "note content for note1"]);

    const result = await processor.processCustomPrompt(doc.content, selectedText);

    expect(result).toContain("This is a {variable} and {var2}.");
    expect(result).toContain("here is the note content for note0");
    expect(result).toContain("note content for note1");
  });

  it("should add 1 selectedText and no context", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Rewrite the following text {}",
    };
    const selectedText = "here is some selected text 12345";

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(["here is the note content for note0", "note content for note1"]);

    const result = await processor.processCustomPrompt(doc.content, selectedText);

    expect(result).toContain("Rewrite the following text {selectedText}");
    expect(result).toContain("here is some selected text 12345");
    expect(result).not.toContain("here is the note content for note0");
    expect(result).not.toContain("note content for note1");
  });

  // This is not an expected use case but it's possible
  it("should add 2 selectedText and no context", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "Rewrite the following text {} and {}",
    };
    const selectedText = "here is some selected text 12345";

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(["here is the note content for note0", "note content for note1"]);

    const result = await processor.processCustomPrompt(doc.content, selectedText);

    expect(result).toContain("Rewrite the following text {selectedText} and {selectedText}");
    expect(result).toContain("here is some selected text 12345");
    expect(result).not.toContain("here is the note content for note0");
    expect(result).not.toContain("note content for note1");
  });

  it("should handle prompts without variables", async () => {
    const doc: CustomPrompt = {
      title: "test-prompt",
      content: "This is a test prompt with no variables.",
    };
    const selectedText = "selected text";

    // Mock the extractVariablesFromPrompt method to return an empty array
    jest.spyOn(processor, "extractVariablesFromPrompt").mockResolvedValue([]);

    const result = await processor.processCustomPrompt(doc.content, selectedText);

    expect(result).toBe("This is a test prompt with no variables.\n\n");
  });

  it("should process a single tag variable correctly", async () => {
    const customPrompt = "Notes related to {#tag} are:";
    const selectedText = "";

    // Mock the extractVariablesFromPrompt method to simulate tag processing
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue(['[{"name":"note","content":"Note content for #tag"}]']);

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

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

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

    expect(result).toContain("Notes related to {#tag1,#tag2,#tag3} are:");
    expect(result).toContain(
      '[{"name":"note1","content":"Note content for #tag1"},{"name":"note2","content":"Note content for #tag2"}]'
    );
  });

  it("should process [[note title]] syntax correctly", async () => {
    const customPrompt = "Content of [[Test Note]] is important.";
    const selectedText = "";

    // Mock the necessary functions
    jest.spyOn(processor, "extractVariablesFromPrompt").mockResolvedValue([]);
    (extractNoteTitles as jest.Mock).mockReturnValue(["Test Note"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue({} as TFile);
    (getFileContent as jest.Mock).mockResolvedValue("Test note content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

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

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

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

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

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
    jest.spyOn(processor, "extractVariablesFromPrompt").mockResolvedValue([]);
    (extractNoteTitles as jest.Mock).mockReturnValue(["Note1", "Note2", "Note3"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue({} as TFile);
    (getFileContent as jest.Mock)
      .mockResolvedValueOnce("Note1 content")
      .mockResolvedValueOnce("Note2 content")
      .mockResolvedValueOnce("Note3 content");

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

    expect(result).toContain("[[Note1]] is related to [[Note2]] and [[Note3]].");
    expect(result).toContain("[[Note1]]:\n\nNote1 content");
    expect(result).toContain("[[Note2]]:\n\nNote2 content");
    expect(result).toContain("[[Note3]]:\n\nNote3 content");
  });

  it("should handle non-existent note titles gracefully", async () => {
    const customPrompt = "[[Non-existent Note]] should not cause errors.";
    const selectedText = "";

    // Mock the necessary functions
    jest.spyOn(processor, "extractVariablesFromPrompt").mockResolvedValue([]);
    (extractNoteTitles as jest.Mock).mockReturnValue(["Non-existent Note"]);
    (getNoteFileFromTitle as jest.Mock).mockResolvedValue(null);

    const result = await processor.processCustomPrompt(customPrompt, selectedText);

    expect(result).toContain("[[Non-existent Note]] should not cause errors.");
    expect(result).not.toContain("[[Non-existent Note]]:");
  });
});
