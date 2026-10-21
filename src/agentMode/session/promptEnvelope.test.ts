import type { TFile } from "obsidian";
import { USER_SENDER } from "@/constants";
import { ContextProcessor } from "@/contextProcessor";
import { FANOUT_READONLY_PREAMBLE } from "./fanout/fanoutTypes";
import {
  buildPromptBlocks,
  buildUserDisplayContent,
  buildUserMessage,
  extractText,
  serializeWebTabContext,
  stripUserMessageWrapper,
  withReadOnlyPreamble,
} from "./promptEnvelope";

describe("promptEnvelope", () => {
  describe("stripUserMessageWrapper()", () => {
    it("returns the typed text from a prompt wrapped with a context block", () => {
      const wrapped =
        "<copilot-context>\nNotes:\n- a.md\n</copilot-context>\n\n" +
        "<user-message>\nsummarize a.md\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("summarize a.md");
    });

    it("keeps the inner newlines of a multi-line prompt", () => {
      const wrapped = "<user-message>\nfirst line\n\nsecond line\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("first line\n\nsecond line");
    });

    it("returns an unwrapped prompt unchanged", () => {
      expect(stripUserMessageWrapper("just a question")).toBe("just a question");
    });

    it("ignores a wrapper tag that an attached note excerpt happens to contain", () => {
      const wrapped =
        "<copilot-context>\nSelected excerpts:\n  the <user-message> tag wraps the prompt\n" +
        "</copilot-context>\n\n<user-message>\nhi\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("hi");
    });

    it("ignores a complete wrapper pair inside an attached note excerpt", () => {
      const wrapped =
        "<copilot-context>\nSelected excerpts:\n  <user-message>sample</user-message>\n" +
        "</copilot-context>\n\n<user-message>\nhi\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("hi");
    });

    it("keeps a closing tag the user typed inside the prompt", () => {
      const wrapped = "<user-message>\nwhat does </user-message> mean?\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("what does </user-message> mean?");
    });

    it("unwraps a prompt stored with trailing whitespace", () => {
      expect(stripUserMessageWrapper("<user-message>\nhi\n</user-message>\n")).toBe("hi");
    });

    it("unwraps a prompt that has text stored after the envelope", () => {
      const stored =
        "<user-message>\ndescribe this\n</user-message>\n\n" +
        "[Unsupported image attachment omitted: image/heic]";

      expect(stripUserMessageWrapper(stored)).toBe("describe this");
    });

    it("returns content unchanged when the closing tag is missing", () => {
      expect(stripUserMessageWrapper("<user-message>\nhalf a prompt")).toBe(
        "<user-message>\nhalf a prompt"
      );
    });
  });

  describe("buildPromptBlocks()", () => {
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
    const makeFile = (path: string) => ({ path }) as unknown as TFile;

    it("returns the message as plain text when no context, or only empty context, is attached", () => {
      expect(buildPromptBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
      expect(buildPromptBlocks("hello", { notes: [], urls: [] })).toEqual([
        { type: "text", text: "hello" },
      ]);
    });

    it("wraps the message with note paths offered as context to open when needed", () => {
      const blocks = buildPromptBlocks("summarize them", {
        notes: [makeFile("daily/2026-04-28.md"), makeFile("projects/copilot.md")],
        urls: [],
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("text");
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<copilot-context>");
      expect(text).toContain("- daily/2026-04-28.md");
      expect(text).toContain("- projects/copilot.md");
      expect(text).toContain("open them if you need their contents");
      expect(text).not.toContain("use the Read tool");
      expect(text).toContain("</copilot-context>");
      expect(text).toContain("<user-message>\nsummarize them\n</user-message>");
    });

    it("inlines selected text excerpts with path and line range", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "s1",
            sourceType: "note",
            notePath: "projects/copilot.md",
            noteTitle: "copilot",
            startLine: 12,
            endLine: 18,
            content: "line one\nline two",
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Selected excerpts");
      expect(text).toContain("- projects/copilot.md (lines 12-18):");
      expect(text).toContain("  line one");
      expect(text).toContain("  line two");
    });

    it("inlines a Reading view excerpt without claiming source lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "reading-excerpt",
            sourceType: "note",
            notePath: "projects/copilot.md",
            noteTitle: "copilot",
            content: "Rendered note passage",
            startLine: 0,
            endLine: 0,
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("- projects/copilot.md:\n  Rendered note passage");
      expect(text).not.toContain("(lines");
    });

    it("appends image content blocks after the text envelope", () => {
      const blocks = buildPromptBlocks("here", undefined, [
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ]);
      expect(blocks).toEqual([
        { type: "text", text: "here" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ]);
    });

    it("combines envelope, text, and content blocks in order", () => {
      const blocks = buildPromptBlocks(
        "look at this",
        {
          notes: [makeFile("a.md")],
          urls: [],
        },
        [
          { type: "text", text: "<attached-pdf path='b.pdf'>parsed body</attached-pdf>" },
          { type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" },
        ]
      );
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe("text");
      const head = (blocks[0] as { type: "text"; text: string }).text;
      expect(head).toContain("<copilot-context>");
      expect(head).toContain("- a.md");
      expect(head).toContain("<user-message>\nlook at this\n</user-message>");
      expect(blocks[1]).toEqual({
        type: "text",
        text: "<attached-pdf path='b.pdf'>parsed body</attached-pdf>",
      });
      expect(blocks[2]).toEqual({ type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" });
    });

    it("serializes web-source selected text excerpts as <web_selected_text>", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "w1",
            sourceType: "web",
            title: "Example",
            url: "https://example.com",
            content: "web snippet",
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<web_selected_text>");
      expect(text).toContain("<title>Example</title>");
      expect(text).toContain("<url>https://example.com</url>");
      expect(text).toContain("web snippet");
      expect(text).toContain("<user-message>\nexplain\n</user-message>");
    });

    it("emits plain text when the web-tab block is empty/whitespace", () => {
      const blocks = buildPromptBlocks("hi", undefined, undefined, "   ");
      expect(blocks).toEqual([{ type: "text", text: "hi" }]);
    });

    it("orders the envelope, web selections, and web-tab block before the message", () => {
      const webTabBlock = "<web_tab_context>\n<url>https://x.dev</url>\n</web_tab_context>";
      const blocks = buildPromptBlocks(
        "look",
        {
          notes: [makeFile("a.md")],
          urls: [],
          selectedTextContexts: [
            { id: "w1", sourceType: "web", title: "W", url: "https://w.dev", content: "snip" },
          ],
        },
        undefined,
        webTabBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      const envelopePos = text.indexOf("<copilot-context>");
      const selectionPos = text.indexOf("<web_selected_text>");
      const webTabPos = text.indexOf("<web_tab_context>");
      const messagePos = text.indexOf("<user-message>");
      expect(envelopePos).toBeGreaterThanOrEqual(0);
      expect(envelopePos).toBeLessThan(selectionPos);
      expect(selectionPos).toBeLessThan(webTabPos);
      expect(webTabPos).toBeLessThan(messagePos);
    });

    it("prepends the project-context block ahead of the attached context and message", () => {
      const projectContextBlock =
        "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>";
      const blocks = buildPromptBlocks(
        "go",
        { notes: [makeFile("a.md")], urls: [] },
        undefined,
        undefined,
        projectContextBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<project_context>");
      expect(text).toContain("`/vault/Papers`");
      expect(text.indexOf("<project_context>")).toBeLessThan(text.indexOf("<copilot-context>"));
      expect(text.indexOf("<copilot-context>")).toBeLessThan(text.indexOf("<user-message>"));
    });

    it("injects the project-context-updates note after the manifest, before the message", () => {
      const updatesBlock =
        "<project_context_updates>\nsources may have changed\n</project_context_updates>";
      const blocks = buildPromptBlocks(
        "go",
        { notes: [makeFile("a.md")], urls: [] },
        undefined,
        undefined,
        "<project_context>\nmanifest\n</project_context>",
        undefined,
        updatesBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<project_context_updates>");
      expect(text.indexOf("<project_context>")).toBeLessThan(
        text.indexOf("<project_context_updates>")
      );
      expect(text.indexOf("<project_context_updates>")).toBeLessThan(
        text.indexOf("<user-message>")
      );
    });

    it("omits the project-context and updates blocks when none are provided (later turns)", () => {
      const blocks = buildPromptBlocks("go", { notes: [makeFile("a.md")], urls: [] });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).not.toContain("<project_context>");
      expect(text).not.toContain("<project_context_updates>");
    });
  });

  describe("buildUserDisplayContent()", () => {
    it("returns undefined when there are no images", () => {
      expect(buildUserDisplayContent("hi")).toBeUndefined();
      expect(buildUserDisplayContent("hi", [])).toBeUndefined();
      expect(buildUserDisplayContent("hi", [{ type: "text", text: "x" }])).toBeUndefined();
    });

    it("puts the prompt text first, then an image_url entry per image", () => {
      expect(
        buildUserDisplayContent("describe these", [
          { type: "image", mimeType: "image/png", data: "AAA=" },
          { type: "image", mimeType: "image/jpeg", data: "BBB=" },
        ])
      ).toEqual([
        { type: "text", text: "describe these" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB=" } },
      ]);
    });

    it("omits the text entry for an image-only message", () => {
      expect(
        buildUserDisplayContent("   ", [{ type: "image", mimeType: "image/png", data: "AAA=" }])
      ).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } }]);
    });
  });

  describe("buildUserMessage()", () => {
    it("builds a visible user bubble with the prompt's id, text, context and timestamp", () => {
      const context = { notes: [], urls: ["https://example.com"] };

      const message = buildUserMessage("p1", "summarize this", context, undefined);

      expect(message).toMatchObject({
        id: "p1",
        message: "summarize this",
        sender: USER_SENDER,
        isVisible: true,
        context,
        content: undefined,
      });
      expect(message.timestamp).not.toBeNull();
    });

    it("shows the prompt's images beside its text", () => {
      const message = buildUserMessage("p1", "describe this", undefined, [
        { type: "image", mimeType: "image/png", data: "AAA=" },
      ]);

      expect(message.content).toEqual([
        { type: "text", text: "describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
      ]);
    });
  });

  describe("withReadOnlyPreamble()", () => {
    it("leads the first text block with the read-only instruction", () => {
      const out = withReadOnlyPreamble([{ type: "text", text: "the question" }]);
      expect(out).toEqual([{ type: "text", text: `${FANOUT_READONLY_PREAMBLE}\n\nthe question` }]);
    });

    it("inserts a leading text block when the prompt has none (image-only)", () => {
      const out = withReadOnlyPreamble([{ type: "image", mimeType: "image/png", data: "x" }]);
      expect(out[0]).toEqual({ type: "text", text: FANOUT_READONLY_PREAMBLE });
      expect(out).toHaveLength(2);
    });
  });

  describe("serializeWebTabContext()", () => {
    afterEach(() => jest.restoreAllMocks());

    it("returns an empty string without asking for page contents when no web tab is attached", async () => {
      const getInstance = jest.spyOn(ContextProcessor, "getInstance");

      expect(await serializeWebTabContext(undefined)).toBe("");
      expect(await serializeWebTabContext({ notes: [], urls: [], webTabs: [] })).toBe("");
      expect(getInstance).not.toHaveBeenCalled();
    });

    it("returns the attached web tabs' processed contents without surrounding whitespace", async () => {
      const processContextWebTabs = jest.fn(
        async () => "\n<web_tab_context>page</web_tab_context>\n"
      );
      jest
        .spyOn(ContextProcessor, "getInstance")
        .mockReturnValue({ processContextWebTabs } as never);
      const webTabs = [{ url: "https://example.com" }];

      expect(await serializeWebTabContext({ notes: [], urls: [], webTabs })).toBe(
        "<web_tab_context>page</web_tab_context>"
      );
      expect(processContextWebTabs).toHaveBeenCalledWith(webTabs);
    });
  });

  describe("extractText()", () => {
    it("returns a text block's text", () => {
      expect(extractText({ type: "text", text: "hello" })).toBe("hello");
    });

    it("returns an empty string for a non-text block", () => {
      expect(extractText({ type: "image", mimeType: "image/png", data: "AAA=" })).toBe("");
    });
  });
});
