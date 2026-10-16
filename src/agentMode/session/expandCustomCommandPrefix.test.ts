import { mockTFile } from "@/__tests__/mockObsidian";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { CustomCommand } from "@/commands/type";

jest.mock("obsidian", () => ({ TFile: jest.fn() }));

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
  describe("expandCustomCommandPrefix()", () => {
    it("returns input unchanged when text does not start with slash", async () => {
      const result = await expandCustomCommandPrefix("hello world", [], "", null);
      expect(result).toEqual({ text: "hello world" });
    });

    it("returns input unchanged when no command matches", async () => {
      const cmds = [makeCommand({ title: "foo", content: "FOO BODY" })];
      const result = await expandCustomCommandPrefix("/unknown", cmds, "", null);
      expect(result).toEqual({ text: "/unknown" });
    });

    it("returns input unchanged for a lone slash", async () => {
      const cmds = [makeCommand({ title: "foo", content: "FOO BODY" })];
      const result = await expandCustomCommandPrefix("/", cmds, "", null);
      expect(result).toEqual({ text: "/" });
    });

    it("returns input unchanged when an empty commands list is given (skill collision case)", async () => {
      const result = await expandCustomCommandPrefix("/foo", [], "", null);
      expect(result).toEqual({ text: "/foo" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 leaves /compact and its arguments unexpanded even when a custom command is titled compact", async () => {
      const cmd = makeCommand({ title: "compact", content: "CUSTOM COMPACT BODY" });
      expect(await expandCustomCommandPrefix("/compact", [cmd], "", null)).toEqual({
        text: "/compact",
      });
      expect(await expandCustomCommandPrefix("/compact keep the API", [cmd], "", null)).toEqual({
        text: "/compact keep the API",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 expands a custom command whose title starts with compact and a space instead of treating it as /compact", async () => {
      const builtinTitle = makeCommand({ title: "compact", content: "CUSTOM COMPACT BODY" });
      const longer = makeCommand({ title: "compact notes", content: "COMPACT NOTES BODY" });
      const result = await expandCustomCommandPrefix(
        "/compact notes",
        [builtinTitle, longer],
        "",
        null
      );
      expect(result).toEqual({ text: "COMPACT NOTES BODY", matched: longer });
    });

    it("expands `/foo` exactly to the command body (no args)", async () => {
      const cmd = makeCommand({ title: "foo", content: "FOO BODY" });
      const result = await expandCustomCommandPrefix("/foo", [cmd], "", null);
      expect(result.matched).toBe(cmd);
      expect(result.text).toBe("FOO BODY");
    });

    it("is case-insensitive on the command title", async () => {
      const cmd = makeCommand({ title: "Random-Hello", content: "Say hi" });
      const result = await expandCustomCommandPrefix("/random-hello", [cmd], "", null);
      expect(result.matched).toBe(cmd);
      expect(result.text).toBe("Say hi");
    });

    it("appends trailing args to the body before processing", async () => {
      const cmd = makeCommand({ title: "foo", content: "FOO BODY" });
      const result = await expandCustomCommandPrefix("/foo bar baz", [cmd], "", null);
      expect(result.matched).toBe(cmd);
      expect(result.text).toBe("FOO BODY\n\nbar baz");
    });

    it("prefers the longest matching title", async () => {
      const fooBar = makeCommand({ title: "foo-bar", content: "LONG" });
      const foo = makeCommand({ title: "foo", content: "SHORT" });
      const result = await expandCustomCommandPrefix("/foo-bar args", [foo, fooBar], "", null);
      expect(result.matched).toBe(fooBar);
      expect(result.text).toBe("LONG\n\nargs");
    });

    it("does not match when the title is a prefix but not followed by whitespace", async () => {
      const foo = makeCommand({ title: "foo", content: "FOO" });
      const result = await expandCustomCommandPrefix("/foobar", [foo], "", null);
      expect(result).toEqual({ text: "/foobar" });
    });

    it("translates {activeNote} to a [[wikilink]] reference, not an inlined note body", async () => {
      const cmd = makeCommand({
        title: "summarize",
        content: "Summarize the {activeNote} using the [[Some Prompt]].",
      });
      const activeNote = mockTFile({
        path: "00_Inbox/Ruby Mailchimp Changes.md",
        basename: "Ruby Mailchimp Changes",
      });

      const result = await expandCustomCommandPrefix("/summarize", [cmd], "", activeNote);

      expect(result.matched).toBe(cmd);
      expect(result.text).toBe(
        "Summarize the [[Ruby Mailchimp Changes]] using the [[Some Prompt]]."
      );
      expect(result.text).not.toContain('<variable name="activeNote">');
    });
  });
});
