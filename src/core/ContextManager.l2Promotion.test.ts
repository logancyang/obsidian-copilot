/**
 * Tests for L2 promotion filtering in ContextManager.buildL2ContextFromPreviousTurns.
 *
 * Verifies that non-recoverable segments (selected_text, web_selected_text) are
 * excluded from L2 promotion to prevent stale context from previous turns
 * shadowing the current turn's fresh context.
 */

import { PromptContextEnvelope, PromptLayerSegment } from "@/context/PromptContextTypes";

// Minimal mocks to avoid deep dependency chains
jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    COPILOT_PLUS_CHAIN: "copilot_plus_chain",
    PROJECT_CHAIN: "project_chain",
  },
}));

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

/**
 * Build a minimal PromptContextEnvelope with L3_TURN segments.
 */
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
    layerHashes: {} as any,
    combinedHash: "test",
  };
}

/**
 * Create a mock MessageRepository that returns the given display messages.
 */
function createMockMessageRepo(messages: Array<{ id: string; sender: string; contextEnvelope?: PromptContextEnvelope }>) {
  return {
    getDisplayMessages: () =>
      messages.map((msg) => ({
        id: msg.id,
        message: "",
        sender: msg.sender,
        isVisible: true,
        contextEnvelope: msg.contextEnvelope,
      })),
  } as any;
}

describe("ContextManager L2 promotion filtering", () => {
  let contextManager: any;

  beforeEach(() => {
    contextManager = ContextManager.getInstance();
  });

  it("should exclude selected_text segments from L2", () => {
    const noteSegment: PromptLayerSegment = {
      id: "notes/test.md",
      content: `<note_context>\n<title>Test</title>\n<path>notes/test.md</path>\n<content>Note content</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/test.md" },
    };

    const selectedTextSegment: PromptLayerSegment = {
      id: "selected_text",
      content: `<selected_text>\n<title>My Note</title>\n<path>dev/file.md</path>\n<start_line>1</start_line>\n<end_line>5</end_line>\n<content>Old selected text that should NOT appear in L2</content>\n</selected_text>`,
      stable: false,
      metadata: { source: "current_turn" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment, selectedTextSegment]),
      },
      { id: "msg-2", sender: "user" }, // current message (no envelope yet)
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    // note_context should be promoted to L2
    expect(l2Context).toContain("note_context");
    expect(l2Context).toContain("Note content");

    // selected_text should NOT be promoted to L2
    expect(l2Context).not.toContain("selected_text");
    expect(l2Context).not.toContain("Old selected text");
  });

  it("should exclude web_selected_text segments from L2", () => {
    const webSelectedSegment: PromptLayerSegment = {
      id: "web_selected_text",
      content: `<web_selected_text>\n<title>React Docs</title>\n<url>https://react.dev</url>\n<content>Web selection content</content>\n</web_selected_text>`,
      stable: false,
      metadata: { source: "current_turn" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([webSelectedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).not.toContain("web_selected_text");
    expect(l2Context).not.toContain("Web selection content");
  });

  it("should promote recoverable blocks (note_context, url_content) to L2", () => {
    const noteSegment: PromptLayerSegment = {
      id: "notes/test.md",
      content: `<note_context>\n<title>Test</title>\n<path>notes/test.md</path>\n<content>Note content here</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/test.md" },
    };

    const urlSegment: PromptLayerSegment = {
      id: "https://example.com",
      content: `<url_content>\n<url>https://example.com</url>\n<content>URL content here</content>\n</url_content>`,
      stable: false,
      metadata: { source: "current_turn" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment, urlSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Note content here");
    expect(l2Context).toContain("URL content here");
  });

  it("should allow unknown/unregistered tags to pass through to L2", () => {
    const priorContextSegment: PromptLayerSegment = {
      id: "old/note.md",
      content: `<prior_context source="old/note.md" type="note">\nCompacted summary\n</prior_context>`,
      stable: false,
      metadata: { source: "previous_turns_compacted", notePath: "old/note.md" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([priorContextSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    // prior_context is not in the registry, so it should pass through
    expect(l2Context).toContain("prior_context");
    expect(l2Context).toContain("Compacted summary");
  });

  it("should handle mixed recoverable and non-recoverable segments correctly", () => {
    const noteSegment: PromptLayerSegment = {
      id: "notes/keep.md",
      content: `<note_context>\n<title>Keep</title>\n<path>notes/keep.md</path>\n<content>Should be in L2</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/keep.md" },
    };

    const selectedSegment: PromptLayerSegment = {
      id: "selected_text",
      content: `<selected_text>\n<title>Drop</title>\n<path>drop.md</path>\n<start_line>1</start_line>\n<end_line>1</end_line>\n<content>Should NOT be in L2</content>\n</selected_text>`,
      stable: false,
      metadata: { source: "current_turn" },
    };

    const urlSegment: PromptLayerSegment = {
      id: "https://keep.com",
      content: `<url_content>\n<url>https://keep.com</url>\n<content>Also in L2</content>\n</url_content>`,
      stable: false,
      metadata: { source: "current_turn" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment, selectedSegment, urlSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Should be in L2");
    expect(l2Context).toContain("Also in L2");
    expect(l2Context).not.toContain("Should NOT be in L2");
  });

  it("should filter non-recoverable blocks inside a compacted multi-block segment", () => {
    // Simulates a compacted envelope where multiple XML blocks are concatenated
    // into a single segment. Non-recoverable blocks (selected_text) should be
    // stripped without dropping the recoverable blocks alongside them.
    const compactedSegment: PromptLayerSegment = {
      id: "compacted_context",
      content: [
        `<selected_text>\n<title>Drop Me</title>\n<path>drop.md</path>\n<start_line>1</start_line>\n<end_line>1</end_line>\n<content>Stale selection in compacted segment</content>\n</selected_text>`,
        `<note_context>\n<title>Keep</title>\n<path>notes/keep.md</path>\n<content>Note in compacted segment</content>\n</note_context>`,
        `<url_content>\n<url>https://keep.com</url>\n<content>URL in compacted segment</content>\n</url_content>`,
      ].join("\n\n"),
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([compactedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Note in compacted segment");
    expect(l2Context).toContain("URL in compacted segment");
    expect(l2Context).not.toContain("<selected_text>");
    expect(l2Context).not.toContain("Stale selection in compacted segment");
  });

  it("should not leak non-recoverable blocks when they appear after recoverable blocks in a compacted segment", () => {
    // Reverse order: recoverable block first, non-recoverable second.
    // The old segment-level check would only inspect the first tag and let
    // the non-recoverable block leak through.
    const compactedSegment: PromptLayerSegment = {
      id: "compacted_context",
      content: [
        `<note_context>\n<title>Note</title>\n<path>notes/a.md</path>\n<content>Recoverable note</content>\n</note_context>`,
        `<web_selected_text>\n<title>Web Sel</title>\n<url>https://example.com</url>\n<content>Stale web selection</content>\n</web_selected_text>`,
      ].join("\n\n"),
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([compactedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Recoverable note");
    expect(l2Context).not.toContain("<web_selected_text>");
    expect(l2Context).not.toContain("Stale web selection");
  });

  it("should not duplicate prior_context_note when compacted segment already contains one", () => {
    // A compacted segment may already contain a prior_context_note from a
    // previous compaction pass. The caller appends one at the end of L2,
    // so compactSegmentForL2 must strip any embedded ones to avoid duplicates.
    const compactedSegment: PromptLayerSegment = {
      id: "compacted_context",
      content: [
        `<prior_context source="note_context" type="compacted">\nSome compacted note\n</prior_context>`,
        `<prior_context_note>\nYou have prior context. Re-fetch if needed.\n</prior_context_note>`,
      ].join("\n\n"),
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([compactedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Some compacted note");
    // prior_context_note should appear exactly once (appended by the caller),
    // not twice (once from the segment + once from the caller).
    const noteCount = (l2Context.match(/<prior_context_note>/g) || []).length;
    expect(noteCount).toBeLessThanOrEqual(1);
  });

  it("should not append re-fetch instruction when only prior_context_note exists without real prior_context blocks", () => {
    // If L2 content contains <prior_context_note> but no actual
    // <prior_context ...> blocks, the re-fetch instruction should NOT
    // be appended. This guards against the old includes("<prior_context")
    // check false-matching on <prior_context_note>.
    const noteSegment: PromptLayerSegment = {
      id: "notes/normal.md",
      content: `<note_context>\n<title>Normal</title>\n<path>notes/normal.md</path>\n<content>Regular note content</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/normal.md" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    // No prior_context blocks exist, so no re-fetch instruction should be appended
    expect(l2Context).toContain("Regular note content");
    expect(l2Context).not.toContain("prior_context_note");
  });

  it("should preserve unknown tags when mixed with known tags in a compacted segment", () => {
    // Regression test: the old "extract whitelist" approach would silently drop
    // unregistered tags. The new "remove blacklist" approach must preserve them.
    const compactedSegment: PromptLayerSegment = {
      id: "compacted_context",
      content: [
        `<note_context>\n<title>Note</title>\n<path>notes/a.md</path>\n<content>Known block</content>\n</note_context>`,
        `<future_block_type>\nSome future content that should survive\n</future_block_type>`,
      ].join("\n\n"),
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([compactedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Known block");
    // Unknown tag must NOT be dropped
    expect(l2Context).toContain("future_block_type");
    expect(l2Context).toContain("Some future content that should survive");
  });

  it("should not false-positive on literal <prior_context> in user note content", () => {
    // User note contains literal XML example text that looks like <prior_context>.
    // The refetch instruction should NOT be appended because there are no real
    // compactor-produced <prior_context source="..."> blocks.
    const noteSegment: PromptLayerSegment = {
      id: "notes/xml-docs.md",
      content: `<note_context>\n<title>XML Docs</title>\n<path>notes/xml-docs.md</path>\n<content>Example: <prior_context> is used for compaction</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/xml-docs.md" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("XML Docs");
    // No real prior_context blocks, so no refetch instruction
    expect(l2Context).not.toContain("prior_context_note");
  });

  it("should not strip literal <selected_text> inside note content", () => {
    // Regression test: if a user note contains literal <selected_text>...</selected_text>
    // as documentation/example text, the single-pass approach must NOT strip it because
    // it's nested inside a recoverable <note_context> block, not a top-level block.
    const noteSegment: PromptLayerSegment = {
      id: "notes/xml-guide.md",
      content: `<note_context>\n<title>XML Guide</title>\n<path>notes/xml-guide.md</path>\n<content>Use <selected_text>your selection here</selected_text> to pass context</content>\n</note_context>`,
      stable: false,
      metadata: { source: "current_turn", notePath: "notes/xml-guide.md" },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([noteSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("XML Guide");
    // The literal <selected_text> inside note content must survive
    expect(l2Context).toContain("your selection here");
  });

  it("should handle two blocks of the same tag independently", () => {
    // Regression test: non-greedy regex with backreference must match each
    // same-tag block independently, not span from first open to last close.
    const segment: PromptLayerSegment = {
      id: "compacted_context",
      content: [
        `<note_context>\n<title>Note A</title>\n<path>a.md</path>\n<content>Content A</content>\n</note_context>`,
        `<note_context>\n<title>Note B</title>\n<path>b.md</path>\n<content>Content B</content>\n</note_context>`,
      ].join("\n\n"),
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([segment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    // Both notes must be present (compacted or verbatim)
    expect(l2Context).toContain("Note A");
    expect(l2Context).toContain("Note B");
  });

  it("should append re-fetch instruction only when real prior_context blocks exist", () => {
    // When a real <prior_context source="..."> block is present,
    // the re-fetch instruction SHOULD be appended.
    const compactedSegment: PromptLayerSegment = {
      id: "compacted_context",
      content: `<prior_context source="note_context" type="compacted">\nCompacted note summary\n</prior_context>`,
      stable: false,
      metadata: { source: "compacted", wasCompacted: true, compactedPaths: [] },
    };

    const mockRepo = createMockMessageRepo([
      {
        id: "msg-1",
        sender: "user",
        contextEnvelope: buildEnvelopeWithL3Segments([compactedSegment]),
      },
      { id: "msg-2", sender: "user" },
    ]);

    const { l2Context } = contextManager.buildL2ContextFromPreviousTurns("msg-2", mockRepo);

    expect(l2Context).toContain("Compacted note summary");
    // Real prior_context block exists, so re-fetch instruction should be present
    expect(l2Context).toContain("prior_context_note");
  });
});
