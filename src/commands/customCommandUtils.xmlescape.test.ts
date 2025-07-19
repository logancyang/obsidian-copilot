import { processPrompt } from "@/commands/customCommandUtils";
import { TFile, Vault } from "obsidian";
import { getFileContent, getFileName, getNotesFromPath } from "@/utils";

// Mock the dependencies
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
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

  it("should escape XML special characters in selected text", async () => {
    const customPrompt = "Process this: {}";
    const selectedText = "<tag>content & \"quotes\" 'apostrophes'</tag>";

    const result = await processPrompt(customPrompt, selectedText, mockVault, mockActiveNote);

    expect(result.processedPrompt).toContain(
      "&lt;tag&gt;content &amp; &quot;quotes&quot; &apos;apostrophes&apos;&lt;/tag&gt;"
    );
    expect(result.processedPrompt).not.toContain(selectedText);
  });

  it("should escape XML in variable names", async () => {
    const customPrompt = 'Use {my"variable<>}';

    const mockNote = {
      basename: 'Note with <special> & "chars"',
      path: "special.md",
    } as TFile;

    (getNotesFromPath as jest.Mock).mockResolvedValue([mockNote]);
    (getFileName as jest.Mock).mockReturnValue(mockNote.basename);
    (getFileContent as jest.Mock).mockResolvedValue('Content with <xml> & special "chars"');

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check variable name is escaped in attribute
    expect(result.processedPrompt).toContain('name="my&quot;variable&lt;&gt;"');

    // Check note title is escaped
    expect(result.processedPrompt).toContain("Note with &lt;special&gt; &amp; &quot;chars&quot;");

    // Check content is escaped
    expect(result.processedPrompt).toContain(
      "Content with &lt;xml&gt; &amp; special &quot;chars&quot;"
    );
  });

  it("should escape XML in active note content", async () => {
    const customPrompt = "Process {activeNote}";

    mockActiveNote.basename = "Note <with> \"XML\" & 'special' chars";

    (getFileContent as jest.Mock).mockResolvedValue(
      'Content: <script>alert("xss")</script> & more'
    );
    (getFileName as jest.Mock).mockReturnValue(mockActiveNote.basename);

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check basename is escaped
    expect(result.processedPrompt).toContain(
      "Note &lt;with&gt; &quot;XML&quot; &amp; &apos;special&apos; chars"
    );

    // Check content is escaped
    expect(result.processedPrompt).toContain(
      "Content: &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; more"
    );
  });

  it("should escape XML in note paths and metadata", async () => {
    const customPrompt = "[[Special Note]]";

    const mockNote = {
      basename: 'Special & "Note"',
      path: 'folder<with>/special&chars/"note".md',
    } as TFile;

    (getNotesFromPath as jest.Mock).mockResolvedValue([]);
    jest.requireMock("@/utils").extractNoteFiles.mockReturnValue([mockNote]);
    (getFileContent as jest.Mock).mockResolvedValue("Content with & and < and >");

    const result = await processPrompt(customPrompt, "", mockVault, mockActiveNote);

    // Check title is escaped
    expect(result.processedPrompt).toContain("<title>Special &amp; &quot;Note&quot;</title>");

    // Check path is escaped
    expect(result.processedPrompt).toContain(
      "<path>folder&lt;with&gt;/special&amp;chars/&quot;note&quot;.md</path>"
    );

    // Check content is escaped
    expect(result.processedPrompt).toContain("Content with &amp; and &lt; and &gt;");
  });

  it("should handle tag variables with XML special characters", async () => {
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

    // Check tag variable name is escaped
    expect(result.processedPrompt).toContain('name="#tag&amp;special"');

    // Check content is properly escaped
    expect(result.processedPrompt).toContain("Tagged &amp; &quot;Note&quot;");
    expect(result.processedPrompt).toContain("Content: &lt;tag&gt; &amp; &lt;/tag&gt;");
  });
});
