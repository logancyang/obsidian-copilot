import { resolveCustomCommandPrefix } from "@/commands/resolveCustomCommandPrefix";
import type { CustomCommand } from "@/commands/type";

function makeCommand(overrides: Partial<CustomCommand>): CustomCommand {
  return {
    title: "test",
    content: "",
    showInContextMenu: false,
    showInSlashMenu: true,
    order: 0,
    modelKey: "",
    lastUsedMs: 0,
    ...overrides,
  };
}

describe("resolveCustomCommandPrefix", () => {
  describe("resolveCustomCommandPrefix()", () => {
    it("returns non-command input unchanged (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", () => {
      expect(resolveCustomCommandPrefix("hello world", [])).toEqual({ text: "hello world" });
    });

    it("returns an unknown slash invocation unchanged (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", () => {
      const command = makeCommand({ title: "summarize", content: "Summarize the note." });

      expect(resolveCustomCommandPrefix("/unknown", [command])).toEqual({ text: "/unknown" });
    });

    it("resolves a command case-insensitively and appends trailing instructions (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", () => {
      const command = makeCommand({ title: "Summarize", content: "Summarize the note." });

      expect(resolveCustomCommandPrefix("/summarize focus on decisions", [command])).toEqual({
        text: "Summarize the note.\n\nfocus on decisions",
        matched: command,
      });
    });

    it("prefers the longest command title that ends at a word boundary (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", () => {
      const short = makeCommand({ title: "review", content: "Short prompt" });
      const long = makeCommand({ title: "review-notes", content: "Long prompt" });

      expect(resolveCustomCommandPrefix("/review-notes", [short, long])).toEqual({
        text: "Long prompt",
        matched: long,
      });
      expect(resolveCustomCommandPrefix("/reviewer", [short, long])).toEqual({
        text: "/reviewer",
      });
    });
  });
});
