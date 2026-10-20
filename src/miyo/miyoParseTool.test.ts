const mockExecFileAsync = jest.fn<Promise<{ stdout: string }>, [string, string[], object]>();
const mockExistsSync = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) => {
    if (id === "fs") return { existsSync: mockExistsSync };
    if (id !== "child_process") return jest.requireActual<object>(`node:${id}`);
    const execFile = Object.assign(jest.fn(), {
      [jest.requireActual<typeof import("node:util")>("node:util").promisify.custom]:
        mockExecFileAsync,
    });
    return { execFile };
  },
}));
import { MIYO_PARSE_TOOL, parseWithMiyoCli, runMiyoParse } from "./miyoParseTool";

const ISSUE_740 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/740";

function parsing(text: string) {
  return { parse: jest.fn().mockResolvedValue(text) };
}

describe("miyoParseTool", () => {
  describe("MIYO_PARSE_TOOL", () => {
    it("requires a path, accepts an offset, and is read-only and always loaded", () => {
      expect(MIYO_PARSE_TOOL.inputSchema).toMatchObject({
        required: ["path"],
        properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 } },
      });
      expect(MIYO_PARSE_TOOL).toMatchObject({
        annotations: { readOnlyHint: true },
        _meta: { "anthropic/alwaysLoad": true },
      });
    });

    it(`${ISSUE_740} tells the agent what it parses, how to page a long document and what to do when it fails, without naming a skill or script`, () => {
      const { description } = MIYO_PARSE_TOOL;

      expect(description).toContain("Convert one PDF or EPUB into Markdown/text");
      expect(description).toContain("call again with that offset to read on");
      expect(description).toContain("read the file with any other tool you have");
      expect(description).not.toMatch(/miyo-parse|\.sh\b|skill/i);
    });
  });

  describe("runMiyoParse()", () => {
    it("returns a short document whole, without trailing newlines or a part footer", async () => {
      const deps = parsing("# Contract\n\nThe term is one year.\n\n");

      expect(await runMiyoParse({ path: "/docs/contract.pdf" }, deps)).toEqual({
        text: "# Contract\n\nThe term is one year.",
        isError: false,
      });
      expect(deps.parse).toHaveBeenCalledWith("/docs/contract.pdf");
    });

    it(`${ISSUE_740} returns a long document in parts that each fit 32,000 bytes and name the offset of the next part`, async () => {
      const book = "a".repeat(70_000);
      const deps = parsing(book);

      const first = await runMiyoParse({ path: "book.epub" }, deps);
      const second = await runMiyoParse({ path: "book.epub", offset: 32_000 }, deps);
      const last = await runMiyoParse({ path: "book.epub", offset: 64_000 }, deps);

      expect(first.text).toBe(
        `${"a".repeat(32_000)}\n\n[Characters 0-32000 of 70000. Call miyo_parse again with offset 32000 for the next part.]`
      );
      expect(second.text).toContain(
        "[Characters 32000-64000 of 70000. Call miyo_parse again with offset 64000 for the next part.]"
      );
      expect(last.text).toBe(
        `${"a".repeat(6_000)}\n\n[Characters 64000-70000 of 70000. End of document.]`
      );
    });

    it(`${ISSUE_740} sizes a part by UTF-8 bytes, so multi-byte text still fits the budget`, async () => {
      const deps = parsing("文".repeat(20_000));

      const { text } = await runMiyoParse({ path: "/docs/zh.pdf" }, deps);
      const part = text.slice(0, text.indexOf("\n\n["));

      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(32_000);
      expect(text).toMatch(/Call miyo_parse again with offset \d+ for the next part\.\]$/);
    });

    it("rejects a missing or blank path without running Miyo", async () => {
      const deps = parsing("unused");

      for (const args of [{}, { path: "   " }, null]) {
        expect(await runMiyoParse(args, deps)).toEqual({
          text: "path must be a non-empty string.",
          isError: true,
        });
      }
      expect(deps.parse).not.toHaveBeenCalled();
    });

    it("reports an offset past the end of the document as an error", async () => {
      expect(await runMiyoParse({ path: "a.pdf", offset: 10 }, parsing("short"))).toEqual({
        text: "offset 10 is past the end of a.pdf (5 characters).",
        isError: true,
      });
    });

    it(`${ISSUE_740} reports a parse failure with Miyo's reason and tells the agent to read the file another way instead of retrying`, async () => {
      const deps = { parse: jest.fn().mockRejectedValue(new Error("Error: File is encrypted")) };

      const result = await runMiyoParse({ path: "/docs/locked.pdf" }, deps);

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Miyo could not parse /docs/locked.pdf.");
      expect(result.text).toContain("read the file with any other tool you have");
      expect(result.text).toContain("don't call miyo_parse again for this file");
      expect(result.text).toContain("Error: File is encrypted");
    });
  });

  describe("parseWithMiyoCli()", () => {
    beforeEach(() => {
      mockExecFileAsync.mockReset();
      mockExistsSync.mockReset();
    });

    it(`${ISSUE_740} runs Miyo's installed CLI from the vault folder and returns its stdout`, async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecFileAsync.mockResolvedValue({ stdout: "# Report\n" });

      expect(await parseWithMiyoCli("notes/report.pdf", "/vault")).toBe("# Report\n");
      const [command, args, options] = mockExecFileAsync.mock.calls[0];
      expect(command).toMatch(/[/\\]miyo(\.exe)?$/);
      expect(command).not.toBe("miyo");
      expect(args).toEqual(["parse", "notes/report.pdf"]);
      expect(options).toMatchObject({ cwd: "/vault" });
    });

    it(`${ISSUE_740} falls back to miyo on PATH when Miyo's install location has no CLI`, async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFileAsync.mockResolvedValue({ stdout: "text" });

      await parseWithMiyoCli("/docs/a.pdf", undefined);

      expect(mockExecFileAsync.mock.calls[0][0]).toBe("miyo");
    });

    it("says the Miyo app is not installed when no CLI can be found", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFileAsync.mockRejectedValue(
        Object.assign(new Error("spawn miyo ENOENT"), { code: "ENOENT" })
      );

      await expect(parseWithMiyoCli("/docs/a.pdf", undefined)).rejects.toThrow(
        "Miyo CLI not found. The Miyo desktop app is not installed on this computer."
      );
    });

    it("rejects with the CLI's stderr when parsing fails", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecFileAsync.mockRejectedValue(
        Object.assign(new Error("Command failed"), { code: 4, stderr: "Error: File not found\n" })
      );

      await expect(parseWithMiyoCli("/docs/missing.pdf", undefined)).rejects.toThrow(
        /^Error: File not found$/
      );
    });
  });
});
