import { PromptContextEnvelope, PromptLayerSegment } from "@/context/PromptContextTypes";

jest.mock("@/aiParams", () => ({
  getSelectedTextContexts: jest.fn().mockReturnValue([]),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({}),
}));

jest.mock("@/contextProcessor", () => ({
  ContextProcessor: {
    getInstance: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("@/mentions/Mention", () => ({
  Mention: {
    getInstance: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("@/context/PromptContextEngine", () => ({
  PromptContextEngine: {
    getInstance: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: jest.fn(),
}));

jest.mock("./ContextCompactor", () => ({}));

import { ContextManager } from "./ContextManager";
import type { MessageRepository } from "./MessageRepository";

type ContextManagerInternal = {
  buildL2ContextFromPreviousTurns: (
    currentMessageId: string,
    messageRepo: MessageRepository
  ) => { l2Context: string; l2Paths: Set<string> };
};

const asInternal = (m: ContextManager): ContextManagerInternal =>
  m as unknown as ContextManagerInternal;

function buildEnvelopeWithL3Segments(segments: PromptLayerSegment[]): PromptContextEnvelope {
  return {
    version: 1,
    conversationId: null,
    messageId: null,
    layers: [
      {
        id: "L3_TURN",
        label: "Current Turn Context",
        text: segments.map((s) => s.content).join("\n"),
        stable: false,
        segments,
        hash: "test",
      },
    ],
    serializedText: "",
    layerHashes: {} as PromptContextEnvelope["layerHashes"],
    combinedHash: "test",
  };
}

function createMockMessageRepo(
  messages: Array<{ id: string; sender: string; contextEnvelope?: PromptContextEnvelope }>
): MessageRepository {
  return {
    getDisplayMessages: () =>
      messages.map((msg) => ({
        id: msg.id,
        message: "",
        sender: msg.sender,
        isVisible: true,
        contextEnvelope: msg.contextEnvelope,
      })),
  } as unknown as MessageRepository;
}

function promoteToL2(manager: ContextManager, segments: PromptLayerSegment[]): string {
  const repo = createMockMessageRepo([
    { id: "msg-1", sender: "user", contextEnvelope: buildEnvelopeWithL3Segments(segments) },
    { id: "msg-2", sender: "user" },
  ]);
  return asInternal(manager).buildL2ContextFromPreviousTurns("msg-2", repo).l2Context;
}

function segment(id: string, content: string): PromptLayerSegment {
  return { id, content, stable: false, metadata: { source: "current_turn" } };
}

function compactedSegment(blocks: string[]): PromptLayerSegment {
  return {
    id: "compacted_context",
    content: blocks.join("\n\n"),
    stable: false,
    metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
  };
}

const noteBlock = (title: string, path: string, content: string) =>
  `<note_context>\n<title>${title}</title>\n<path>${path}</path>\n<content>${content}</content>\n</note_context>`;
const urlBlock = (url: string, content: string) =>
  `<url_content>\n<url>${url}</url>\n<content>${content}</content>\n</url_content>`;
const selectedTextBlock = (content: string) =>
  `<selected_text>\n<title>My Note</title>\n<path>dev/file.md</path>\n<start_line>1</start_line>\n<end_line>5</end_line>\n<content>${content}</content>\n</selected_text>`;
const webSelectedTextBlock = (content: string) =>
  `<web_selected_text>\n<title>React Docs</title>\n<url>https://react.dev</url>\n<content>${content}</content>\n</web_selected_text>`;

describe("ContextManager", () => {
  describe("ContextManager", () => {
    let contextManager: ContextManager;

    beforeEach(() => {
      contextManager = ContextManager.getInstance();
    });

    describe("buildL2ContextFromPreviousTurns()", () => {
      it("promotes recoverable note and URL blocks from earlier turns", () => {
        const l2Context = promoteToL2(contextManager, [
          segment("notes/test.md", noteBlock("Test", "notes/test.md", "Note content here")),
          segment("https://example.com", urlBlock("https://example.com", "URL content here")),
        ]);

        expect(l2Context).toContain("Note content here");
        expect(l2Context).toContain("URL content here");
      });

      it("drops selected_text blocks but keeps the note blocks beside them", () => {
        const l2Context = promoteToL2(contextManager, [
          segment("notes/test.md", noteBlock("Test", "notes/test.md", "Note content")),
          segment("selected_text", selectedTextBlock("Old selected text")),
        ]);

        expect(l2Context).toContain("Note content");
        expect(l2Context).not.toContain("selected_text");
        expect(l2Context).not.toContain("Old selected text");
      });

      it("drops web_selected_text blocks", () => {
        const l2Context = promoteToL2(contextManager, [
          segment("web_selected_text", webSelectedTextBlock("Web selection content")),
        ]);

        expect(l2Context).not.toContain("web_selected_text");
        expect(l2Context).not.toContain("Web selection content");
      });

      it("drops non-recoverable blocks anywhere inside a compacted multi-block segment", () => {
        const l2Context = promoteToL2(contextManager, [
          compactedSegment([
            selectedTextBlock("Stale selection before"),
            noteBlock("Keep", "notes/keep.md", "Note in compacted segment"),
            webSelectedTextBlock("Stale web selection after"),
            urlBlock("https://keep.com", "URL in compacted segment"),
          ]),
        ]);

        expect(l2Context).toContain("Note in compacted segment");
        expect(l2Context).toContain("URL in compacted segment");
        expect(l2Context).not.toContain("<selected_text>");
        expect(l2Context).not.toContain("Stale selection before");
        expect(l2Context).not.toContain("<web_selected_text>");
        expect(l2Context).not.toContain("Stale web selection after");
      });

      it("keeps unregistered block types beside known blocks in a compacted segment", () => {
        const l2Context = promoteToL2(contextManager, [
          compactedSegment([
            noteBlock("Note", "notes/a.md", "Known block"),
            `<future_block_type>\nSome future content that should survive\n</future_block_type>`,
          ]),
        ]);

        expect(l2Context).toContain("Known block");
        expect(l2Context).toContain("Some future content that should survive");
      });

      it("keeps prior_context blocks and appends the re-fetch instruction once", () => {
        const l2Context = promoteToL2(contextManager, [
          compactedSegment([
            `<prior_context source="note_context" type="compacted">\nCompacted note summary\n</prior_context>`,
          ]),
        ]);

        expect(l2Context).toContain("Compacted note summary");
        expect(l2Context.match(/<prior_context_note>/g)).toHaveLength(1);
      });

      it("replaces a stored prior_context_note instead of duplicating it", () => {
        const l2Context = promoteToL2(contextManager, [
          compactedSegment([
            `<prior_context source="note_context" type="compacted">\nSome compacted note\n</prior_context>`,
            `<prior_context_note>\nYou have prior context. Re-fetch if needed.\n</prior_context_note>`,
          ]),
        ]);

        expect(l2Context).toContain("Some compacted note");
        expect(l2Context).not.toContain("You have prior context");
        expect(l2Context.match(/<prior_context_note>/g)).toHaveLength(1);
      });

      it("does not append the re-fetch instruction when note content merely mentions <prior_context>", () => {
        const l2Context = promoteToL2(contextManager, [
          segment(
            "notes/xml-docs.md",
            noteBlock(
              "XML Docs",
              "notes/xml-docs.md",
              "Example: <prior_context> is used for compaction"
            )
          ),
        ]);

        expect(l2Context).toContain("XML Docs");
        expect(l2Context).not.toContain("prior_context_note");
      });

      it("keeps a literal <selected_text> tag that appears inside note content", () => {
        const l2Context = promoteToL2(contextManager, [
          segment(
            "notes/xml-guide.md",
            noteBlock(
              "XML Guide",
              "notes/xml-guide.md",
              "Use <selected_text>your selection here</selected_text> to pass context"
            )
          ),
        ]);

        expect(l2Context).toContain("XML Guide");
        expect(l2Context).toContain("your selection here");
      });
    });
  });
});
