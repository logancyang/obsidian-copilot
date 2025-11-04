import { processPrompt } from "@/commands/customCommandUtils";
import { TFile, Vault } from "obsidian";
import { getFileContent, getFileName, getNotesFromPath } from "@/utils";

// Mock the dependencies
jest.mock("@/utils", () => ({
  extractTemplateNoteFiles: jest.fn().mockReturnValue([]),
  getFileContent: jest.fn(),
  getFileName: jest.fn(),
  getNotesFromPath: jest.fn(),
  getNotesFromTags: jest.fn(),
  processVariableNameForNotePath: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    debug: false,
    enableCustomPromptTemplating: true,
  })),
}));

describe("XML Escaping in processPrompt", () => {
  let mockVault: Vault;
  let mockActiveNote: TFile;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVault = {
      adapter: {
        stat: jest.fn().mockResolvedValue({
          ctime: Date.now(),
          mtime: Date.now(),
        }),
      },
    } as unknown as Vault;

    mockActiveNote = {
      path: "path/to/active/note.md",
      basename: "Active Note",
    } as TFile;
  });

  it("should NOT escape XML special characters in selected text", async () => {
    const customPrompt = "Process this: {}";
    const selectedText = "<tag>content & \"quotes\" 'apostrophes'</tag>";

    const result = await processPrompt(customPrompt, selectedText, mockVault, mockActiveNote);

    // Should contain the original unescaped text
    expect(result.processedPrompt).toContain(selectedText);
    // Should NOT contain escaped characters
    expect(result.processedPrompt).not.toContain("&lt;");
    expect(result.processedPrompt).not.toContain("&amp;");
    expect(result.processedPrompt).not.toContain("&quot;");
    expect(result.processedPrompt).not.toContain("&apos;");
  });

  it("should NOT escape XML in variable names", async () => {
    const customPrompt = 'Use {my"variable<>}';

    const mockNote = {
      basename: 'Note with <special> & "chars"',
      path: "special.md",
    } as TFile;

    (getNotesFromPath as jest.Mock).mockResolvedValue([mockNote]);
    (getFileName as jest.Mock).mockReturnValue(mockNote.basename);
    (getFileContent as jest.Mock).mockResolvedValue('Content with <xml> & special "chars"');

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check variable name is NOT escaped in attribute
    expect(result.processedPrompt).toContain('name="my"variable<>"');

    // Check note title is NOT escaped
    expect(result.processedPrompt).toContain('Note with <special> & "chars"');

    // Check content is NOT escaped
    expect(result.processedPrompt).toContain('Content with <xml> & special "chars"');
  });

  it("should NOT escape XML in active note content", async () => {
    const customPrompt = "Process {activeNote}";

    mockActiveNote.basename = "Note <with> \"XML\" & 'special' chars";

    (getFileContent as jest.Mock).mockResolvedValue(
      'Content: <script>alert("xss")</script> & more'
    );
    (getFileName as jest.Mock).mockReturnValue(mockActiveNote.basename);

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check basename is NOT escaped
    expect(result.processedPrompt).toContain("Note <with> \"XML\" & 'special' chars");

    // Check content is NOT escaped
    expect(result.processedPrompt).toContain('Content: <script>alert("xss")</script> & more');
  });

  it("should NOT escape XML in note paths and metadata", async () => {
    const customPrompt = "[[Special Note]]";

    const mockNote = {
      basename: 'Special & "Note"',
      path: 'folder<with>/special&chars/"note".md',
    } as TFile;

    (getNotesFromPath as jest.Mock).mockResolvedValue([]);
    jest.requireMock("@/utils").extractTemplateNoteFiles.mockReturnValue([mockNote]);
    (getFileContent as jest.Mock).mockResolvedValue("Content with & and < and >");

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check title is NOT escaped
    expect(result.processedPrompt).toContain('<title>Special & "Note"</title>');

    // Check path is NOT escaped
    expect(result.processedPrompt).toContain('folder<with>/special&chars/"note".md');

    // Check content is NOT escaped
    expect(result.processedPrompt).toContain("Content with & and < and >");
  });

  it("should NOT escape XML in tag variables", async () => {
    const customPrompt = "Notes for {#tag&special}";

    const mockNote = {
      basename: 'Tagged & "Note"',
      path: "tagged.md",
    } as TFile;

    (getNotesFromPath as jest.Mock).mockResolvedValue([]);
    jest.requireMock("@/utils").getNotesFromTags.mockResolvedValue([mockNote]);
    (getFileName as jest.Mock).mockReturnValue(mockNote.basename);
    (getFileContent as jest.Mock).mockResolvedValue("Content: <tag> & </tag>");

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check tag variable name is NOT escaped
    expect(result.processedPrompt).toContain('name="#tag&special"');

    // Check content is NOT escaped
    expect(result.processedPrompt).toContain('Tagged & "Note"');
    expect(result.processedPrompt).toContain("Content: <tag> & </tag>");
  });
});
