import { MiyoRequestError } from "@/miyo/MiyoClient";
import type { CopilotSettings } from "@/settings/model";
import {
  createMiyoParse,
  MIYO_PARSE_TOOL,
  parseWithMiyo,
  type MiyoParseDeps,
} from "./miyoParseTool";

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

  describe("createMiyoParse()", () => {
    it("returns a short document whole, without trailing newlines or a part footer", async () => {
      const deps = parsing("# Contract\n\nThe term is one year.\n\n");

      expect(await createMiyoParse(deps.parse)({ path: "/docs/contract.pdf" })).toEqual({
        text: "# Contract\n\nThe term is one year.",
        isError: false,
      });
      expect(deps.parse).toHaveBeenCalledWith("/docs/contract.pdf");
    });

    it(`${ISSUE_740} returns a long document in parts that each fit 32,000 bytes and name the offset of the next part, parsing it only once`, async () => {
      const book = "a".repeat(70_000);
      const deps = parsing(book);
      const parse = createMiyoParse(deps.parse);

      const first = await parse({ path: "book.epub" });
      const second = await parse({ path: "book.epub", offset: 32_000 });
      const last = await parse({ path: "book.epub", offset: 64_000 });

      expect(first.text).toBe(
        `${"a".repeat(32_000)}\n\n[Characters 0-32000 of 70000. Call miyo_parse again with offset 32000 for the next part.]`
      );
      expect(second.text).toContain(
        "[Characters 32000-64000 of 70000. Call miyo_parse again with offset 64000 for the next part.]"
      );
      expect(last.text).toBe(
        `${"a".repeat(6_000)}\n\n[Characters 64000-70000 of 70000. End of document.]`
      );
      expect(deps.parse).toHaveBeenCalledTimes(1);
    });

    it(`${ISSUE_740} parses the document again when it is read from the start or after its last part, so edits to the file show up`, async () => {
      const deps = parsing("a".repeat(40_000));
      const parse = createMiyoParse(deps.parse);

      await parse({ path: "book.epub" });
      await parse({ path: "book.epub" });
      await parse({ path: "book.epub", offset: 32_000 });
      await parse({ path: "book.epub", offset: 32_000 });

      expect(deps.parse).toHaveBeenCalledTimes(3);
    });

    it(`${ISSUE_740} parses another document when the offset names a different path than the one being paged`, async () => {
      const deps = parsing("a".repeat(40_000));
      const parse = createMiyoParse(deps.parse);

      await parse({ path: "one.epub" });
      await parse({ path: "two.epub", offset: 32_000 });

      expect(deps.parse.mock.calls).toEqual([["one.epub"], ["two.epub"]]);
    });

    it(`${ISSUE_740} ends a part before an emoji rather than between its two UTF-16 halves`, async () => {
      const deps = parsing(`a${"😀".repeat(20_000)}`);
      const parse = createMiyoParse(deps.parse);

      const first = await parse({ path: "/docs/emoji.pdf" });
      const second = await parse({ path: "/docs/emoji.pdf", offset: 15_303 });

      expect(first.text).toBe(
        `a${"😀".repeat(7_651)}\n\n[Characters 0-15303 of 40001. Call miyo_parse again with offset 15303 for the next part.]`
      );
      expect(second.text.startsWith("😀😀")).toBe(true);
    });

    it(`${ISSUE_740} sizes a part by UTF-8 bytes, so multi-byte text still fits the budget`, async () => {
      const deps = parsing("文".repeat(20_000));

      const { text } = await createMiyoParse(deps.parse)({ path: "/docs/zh.pdf" });
      const part = text.slice(0, text.indexOf("\n\n["));

      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(32_000);
      expect(text).toMatch(/Call miyo_parse again with offset \d+ for the next part\.\]$/);
    });

    it("rejects a missing or blank path without running Miyo", async () => {
      const deps = parsing("unused");

      for (const args of [{}, { path: "   " }, null]) {
        expect(await createMiyoParse(deps.parse)(args)).toEqual({
          text: "path must be a non-empty string.",
          isError: true,
        });
      }
      expect(deps.parse).not.toHaveBeenCalled();
    });

    it("passes a path with surrounding whitespace to Miyo unchanged, since filenames may start or end with spaces", async () => {
      const deps = parsing("text");

      await createMiyoParse(deps.parse)({ path: "/docs/report.pdf " });

      expect(deps.parse).toHaveBeenCalledWith("/docs/report.pdf ");
    });

    it("reports an offset past the end of the document as an error", async () => {
      expect(await createMiyoParse(parsing("short").parse)({ path: "a.pdf", offset: 10 })).toEqual({
        text: "offset 10 is past the end of a.pdf (5 characters).",
        isError: true,
      });
    });

    it(`${ISSUE_740} reports a parse failure with Miyo's reason and tells the agent to read the file another way instead of retrying`, async () => {
      const deps = { parse: jest.fn().mockRejectedValue(new Error("Error: File is encrypted")) };

      const result = await createMiyoParse(deps.parse)({ path: "/docs/locked.pdf" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Miyo could not parse /docs/locked.pdf.");
      expect(result.text).toContain("read the file with any other tool you have");
      expect(result.text).toContain("don't call miyo_parse again for this file");
      expect(result.text).toContain("Error: File is encrypted");
    });
  });

  describe("parseWithMiyo()", () => {
    function setup(settings: Partial<CopilotSettings> = {}) {
      const client = {
        resolveBaseUrl: jest.fn().mockResolvedValue("http://127.0.0.1:8742"),
        parseDoc: jest
          .fn()
          .mockResolvedValue({ text: "# Report", format: "pdf", source_path: "x" }),
      };
      const deps: MiyoParseDeps = {
        client,
        getSettings: () =>
          ({ miyoConnectionMode: "local", miyoServerUrl: "", ...settings }) as CopilotSettings,
        getVaultName: () => "Research Vault",
        getVaultBase: () => "/Users/me/Research Vault",
      };
      return { client, deps };
    }

    it("asks the connected Miyo to parse a vault path in this vault and returns its text", async () => {
      const { client, deps } = setup();

      expect(await parseWithMiyo("notes/report.pdf", deps)).toBe("# Report");
      expect(client.parseDoc).toHaveBeenCalledWith(
        "http://127.0.0.1:8742",
        "Research Vault",
        "notes/report.pdf"
      );
    });

    it("sends a remote Miyo's server URL to resolve the service", async () => {
      const { client, deps } = setup({
        miyoConnectionMode: "remote",
        miyoServerUrl: "https://miyo.example.com",
      });

      await parseWithMiyo("notes/report.pdf", deps);

      expect(client.resolveBaseUrl).toHaveBeenCalledWith("https://miyo.example.com");
    });

    it(`${ISSUE_740} sends an absolute path inside the vault relative to the vault, so a remote Miyo finds it in its copy`, async () => {
      const { client, deps } = setup();

      await parseWithMiyo("/Users/me/Research Vault/notes/report.pdf", deps);

      expect(client.parseDoc.mock.calls[0][2]).toBe("notes/report.pdf");
    });

    it("sends an absolute path outside the vault unchanged", async () => {
      const { client, deps } = setup();

      await parseWithMiyo("/Users/me/Downloads/book.epub", deps);

      expect(client.parseDoc.mock.calls[0][2]).toBe("/Users/me/Downloads/book.epub");
    });

    it("rejects with Miyo's reason when it can't parse the file", async () => {
      const { client, deps } = setup();
      client.parseDoc.mockRejectedValue(new MiyoRequestError(404, "File not found"));

      await expect(parseWithMiyo("missing.pdf", deps)).rejects.toThrow("File not found");
    });
  });
});
