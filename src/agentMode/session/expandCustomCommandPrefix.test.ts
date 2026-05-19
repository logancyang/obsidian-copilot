import { mockTFile } from "@/__tests__/mockObsidian";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { CustomCommand } from "@/commands/type";
import { extractTemplateNoteFiles } from "@/utils";
import { Vault } from "obsidian";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/utils", () => {
  const actual = jest.requireActual<{ stripFrontmatter: unknown }>("@/utils");
  return {
    extractTemplateNoteFiles: jest.fn().mockReturnValue([]),
    getFileContent: jest.fn(),
    getFileName: jest.fn(),
    getNotesFromPath: jest.fn(),
    getNotesFromTags: jest.fn(),
    processVariableNameForNotePath: jest.fn(),
    stripFrontmatter: actual.stripFrontmatter,
  };
});

const makeCommand = (overrides: Partial<CustomCommand>): CustomCommand => ({
  title: "test",
  content: "",
  showInContextMenu: false,
  showInSlashMenu: true,
  order: 0,
  modelKey: "",
  lastUsedMs: 0,
  ...overrides,
});

describe("expandCustomCommandPrefix", () => {
  let vault: Vault;

  beforeEach(() => {
    jest.clearAllMocks();
    (extractTemplateNoteFiles as jest.Mock).mockReturnValue([]);
    vault = {
      adapter: {
        stat: jest.fn().mockResolvedValue({ ctime: Date.now(), mtime: Date.now() }),
      },
    } as unknown as Vault;
  });

  it("returns input unchanged when text does not start with slash", async () => {
    const result = await expandCustomCommandPrefix("hello world", [], vault, "", null);
    expect(result).toEqual({ text: "hello world" });
  });

  it("returns input unchanged when no command matches", async () => {
    const cmds = [makeCommand({ title: "foo", content: "FOO BODY" })];
    const result = await expandCustomCommandPrefix("/unknown", cmds, vault, "", null);
    expect(result).toEqual({ text: "/unknown" });
  });

  it("returns input unchanged for a lone slash", async () => {
    const cmds = [makeCommand({ title: "foo", content: "FOO BODY" })];
    const result = await expandCustomCommandPrefix("/", cmds, vault, "", null);
    expect(result).toEqual({ text: "/" });
  });

  it("returns input unchanged when an empty commands list is given (skill collision case)", async () => {
    // Mirrors composeSlashMenuItems: if a skill shadows the command title,
    // the command never reaches this expander, so an empty list = pass-through.
    const result = await expandCustomCommandPrefix("/foo", [], vault, "", null);
    expect(result).toEqual({ text: "/foo" });
  });

  it("expands `/foo` exactly to the command body (no args)", async () => {
    const cmd = makeCommand({ title: "foo", content: "FOO BODY" });
    const result = await expandCustomCommandPrefix("/foo", [cmd], vault, "", null);
    expect(result.matched).toBe(cmd);
    expect(result.text).toBe("FOO BODY\n\n");
  });

  it("is case-insensitive on the command title", async () => {
    const cmd = makeCommand({ title: "Random-Hello", content: "Say hi" });
    const result = await expandCustomCommandPrefix("/random-hello", [cmd], vault, "", null);
    expect(result.matched).toBe(cmd);
    expect(result.text).toBe("Say hi\n\n");
  });

  it("appends trailing args to the body before processing", async () => {
    const cmd = makeCommand({ title: "foo", content: "FOO BODY" });
    const result = await expandCustomCommandPrefix("/foo bar baz", [cmd], vault, "", null);
    expect(result.matched).toBe(cmd);
    expect(result.text).toBe("FOO BODY\n\nbar baz\n\n");
  });

  it("prefers the longest matching title", async () => {
    const fooBar = makeCommand({ title: "foo-bar", content: "LONG" });
    const foo = makeCommand({ title: "foo", content: "SHORT" });
    const result = await expandCustomCommandPrefix("/foo-bar args", [foo, fooBar], vault, "", null);
    expect(result.matched).toBe(fooBar);
    expect(result.text).toBe("LONG\n\nargs\n\n");
  });

  it("does not match when the title is a prefix but not followed by whitespace", async () => {
    const foo = makeCommand({ title: "foo", content: "FOO" });
    const result = await expandCustomCommandPrefix("/foobar", [foo], vault, "", null);
    expect(result).toEqual({ text: "/foobar" });
  });

  it("expands `{}` against selected text", async () => {
    const cmd = makeCommand({ title: "rewrite", content: "Rewrite this: {}" });
    const result = await expandCustomCommandPrefix(
      "/rewrite",
      [cmd],
      vault,
      "the selected paragraph",
      null
    );
    expect(result.matched).toBe(cmd);
    expect(result.text).toBe(
      "Rewrite this: {selected_text}\n\n<selected_text>\nthe selected paragraph\n</selected_text>"
    );
  });

  it("treats activeNote as the {} target when no selection is present", async () => {
    const cmd = makeCommand({ title: "summarize", content: "Summarize: {}" });
    const activeNote = mockTFile({ path: "notes/today.md", basename: "today" });
    const utils = jest.requireMock<{ getFileContent: jest.Mock }>("@/utils");
    utils.getFileContent.mockResolvedValue("note body");

    const result = await expandCustomCommandPrefix("/summarize", [cmd], vault, "", activeNote);
    expect(result.matched).toBe(cmd);
    expect(result.text).toContain('<selected_text type="active_note">');
    expect(result.text).toContain("note body");
  });
});
