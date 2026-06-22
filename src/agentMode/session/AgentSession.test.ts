import { AI_SENDER, USER_SENDER } from "@/constants";
import type { TFile } from "obsidian";
import {
  AgentSession,
  buildPromptBlocks,
  buildUserDisplayContent,
  tryReadExitPlanModeCall,
  withReadOnlyPreamble,
} from "./AgentSession";
import { ensureMultiAgentEntitlement, showMultiAgentUpgradePrompt } from "@/plusUtils";
import { AuthRequiredError, MethodUnsupportedError } from "./errors";
import type { FanoutRunInput } from "./fanout/FanoutOrchestrator";
import { FANOUT_READONLY_PREAMBLE, type FanoutTurn } from "./fanout/fanoutTypes";
import type {
  AgentToolCallOutput,
  BackendDescriptor,
  BackendProcess,
  BackendState,
  SessionEvent,
  SessionUpdateHandler,
} from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: { mcpServers: [] } }),
}));
// The authoritative send-boundary paywall (Phase 4) lives in plusUtils; mock it
// so fan-out tests don't reach the real `isPlusEnabled()`/BrevilabsClient. The
// helper defaults to "entitled" so existing fan-out tests keep passing; the
// paywall tests below flip it per-case.
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

interface MockBackend {
  asBackend: BackendProcess;
  registerHandler: jest.Mock;
  emit: (event: SessionEvent) => void;
  prompt: jest.Mock;
  cancel: jest.Mock;
  newSession: jest.Mock;
  setSessionModel: jest.Mock;
  setSessionConfigOption: jest.Mock;
  setSessionMode: jest.Mock;
  listSessions: jest.Mock;
}

function emptyState(): BackendState {
  return { model: null, mode: null };
}

function makeMockBackend(): MockBackend {
  let handler: SessionUpdateHandler | null = null;
  const registerHandler = jest.fn((_id: string, h: SessionUpdateHandler) => {
    handler = h;
    return () => {
      handler = null;
    };
  });
  const prompt = jest.fn(async () => ({ stopReason: "end_turn" as const }));
  const cancel = jest.fn(async () => undefined);
  const newSession = jest.fn(async () => ({ sessionId: "acp-1", state: emptyState() }));
  const setSessionModel = jest.fn(async () => emptyState());
  const setSessionConfigOption = jest.fn(async () => emptyState());
  const setSessionMode = jest.fn(async () => emptyState());
  const listSessions = jest.fn(async () => ({ sessions: [] }));
  const backend: BackendProcess = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: registerHandler,
    newSession: newSession,
    prompt: prompt,
    cancel: cancel,
    setSessionModel: setSessionModel,
    isSetSessionModelSupported: () => true,
    setSessionMode: setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: setSessionConfigOption,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: listSessions,
    resumeSession: () => Promise.reject(new MethodUnsupportedError("resume")),
    loadSession: () => Promise.reject(new MethodUnsupportedError("load")),
    supportsMcpTransport: () => false,
    shutdown: async () => {},
  };
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    setSessionConfigOption,
    setSessionMode,
    listSessions,
    emit: (event) => handler?.(event),
  };
}

/** Descriptor stub for a backend that summarizes its own titles (opencode). */
function summarizingDescriptor(): BackendDescriptor {
  return { summarizesSessionTitle: true } as unknown as BackendDescriptor;
}

/** Descriptor stub for a backend that does NOT summarize (codex, Claude Code). */
function nonSummarizingDescriptor(): BackendDescriptor {
  return { summarizesSessionTitle: false } as unknown as BackendDescriptor;
}

describe("buildPromptBlocks", () => {
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  const makeFile = (path: string) => ({ path }) as unknown as TFile;

  it("returns plain text when no context is attached", () => {
    expect(buildPromptBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns plain text when context has no notes or excerpts", () => {
    const blocks = buildPromptBlocks("hello", { notes: [], urls: [] });
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("wraps the message with note paths when contextNotes are attached", () => {
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

  it("weaves the web-tab block before the user message", () => {
    const webTabBlock =
      "<active_web_tab>\n<title>Docs</title>\n<url>https://x.dev</url>\n<content>\nhello\n</content>\n</active_web_tab>";
    const blocks = buildPromptBlocks("read it", { notes: [], urls: [] }, undefined, webTabBlock);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { type: "text"; text: string }).text;
    expect(text).toContain("<active_web_tab>");
    expect(text).toContain("<url>https://x.dev</url>");
    expect(text).toContain("<user-message>\nread it\n</user-message>");
    // Context (web-tab content) precedes the user message.
    expect(text.indexOf("<active_web_tab>")).toBeLessThan(text.indexOf("<user-message>"));
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
});

describe("AgentSession.loadDisplayMessages", () => {
  it("replaces the transcript and notifies subscribers so an open view re-renders", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onMessagesChanged = jest.fn();
    session.subscribe({ onMessagesChanged, onStatusChanged: () => {} });

    session.loadDisplayMessages([
      {
        id: "m0",
        sender: USER_SENDER,
        message: "earlier prompt",
        isVisible: true,
        timestamp: null,
      },
      { id: "m1", sender: AI_SENDER, message: "earlier reply", isVisible: true, timestamp: null },
    ]);

    // The missing notification here was the bug: store.loadMessages alone left
    // a freshly-activated tab blank until a tab switch forced a re-read.
    expect(onMessagesChanged).toHaveBeenCalledTimes(1);
    expect(session.hasUserVisibleMessages()).toBe(true);
    expect(session.store.getDisplayMessages().map((m) => m.message)).toEqual([
      "earlier prompt",
      "earlier reply",
    ]);
  });
});

describe("AgentSession.restoreLabel", () => {
  function makeResumedSession(mock: ReturnType<typeof makeMockBackend>) {
    return new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
  }

  it("an agent-sourced restored title can still be refreshed by later agent updates", () => {
    const mock = makeMockBackend();
    const session = makeResumedSession(mock);
    session.restoreLabel("Discovered title", "agent");
    expect(session.getLabel()).toBe("Discovered title");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Newer agent title" },
    });
    expect(session.getLabel()).toBe("Newer agent title");
  });

  it("a user-sourced restored title is sticky against later agent updates", () => {
    const mock = makeMockBackend();
    const session = makeResumedSession(mock);
    session.restoreLabel("My rename", "user");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Agent title" },
    });
    expect(session.getLabel()).toBe("My rename");
  });
});

describe("buildUserDisplayContent", () => {
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

describe("AgentSession.sendPrompt", () => {
  it("appends user + placeholder synchronously and resolves on stopReason", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { userMessageId, turn } = session.sendPrompt("Hi there");

    const messages = session.store.getDisplayMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: userMessageId,
      sender: USER_SENDER,
      message: "Hi there",
    });
    expect(messages[1]).toMatchObject({ sender: AI_SENDER, message: "" });
    expect(session.getStatus()).toBe("running");

    const stopReason = await turn;
    expect(stopReason).toBe("end_turn");
    expect(session.getStatus()).toBe("idle");
    expect(mock.prompt).toHaveBeenCalledWith({
      sessionId: "acp-1",
      prompt: [{ type: "text", text: "Hi there" }],
    });
  });

  it("forwards image content blocks to the backend prompt", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.sendPrompt("describe", undefined, [
      { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    ]).turn;
    const messages = session.store.getDisplayMessages();
    expect(messages[0].message).toBe("describe");
    // The posted user bubble carries the prompt text plus the image as a
    // renderable data-URL entry, while the backend still receives the original
    // base64 image block.
    expect(messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
    expect(mock.prompt).toHaveBeenCalledWith({
      sessionId: "acp-1",
      prompt: [
        { type: "text", text: "describe" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ],
    });
  });

  it("leaves the user message content unset when no images are attached", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.sendPrompt("just text");
    expect(session.store.getDisplayMessages()[0].content).toBeUndefined();
  });

  it("rejects if a turn is already in flight", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.sendPrompt("first");
    expect(() => session.sendPrompt("second")).toThrow(/in flight/);
  });

  it("marks an empty completed turn as a visible error message", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    await session.sendPrompt("hi").turn;

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toMatch(/without returning any assistant text or tool activity/);
  });

  it("includes nested provider errors when a prompt rejects", async () => {
    const mock = makeMockBackend();
    const error = new Error("stream error");
    (error as { cause?: unknown }).cause = {
      data: {
        error: {
          type: "FreeUsageLimitError",
          message: "Rate limit exceeded. Please try again later.",
        },
      },
    };
    mock.prompt.mockRejectedValueOnce(error);
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    await expect(session.sendPrompt("hi").turn).rejects.toThrow("stream error");

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toContain("FreeUsageLimitError");
    expect(placeholder?.message).toContain("Rate limit exceeded");
  });

  it("surfaces a provider error stringified inside data.message (codex-acp)", async () => {
    const mock = makeMockBackend();
    // codex-acp reports JSON-RPC -32603 "Internal error" with the real provider
    // error nested as a JSON *string* in data.message.
    const error = new Error("Internal error");
    (error as { data?: unknown }).data = {
      message: JSON.stringify({
        type: "error",
        status: 400,
        error: {
          type: "invalid_request_error",
          message:
            "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
        },
      }),
      codex_error_info: "other",
    };
    mock.prompt.mockRejectedValueOnce(error);
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "codex",
    });

    await expect(session.sendPrompt("hi").turn).rejects.toThrow("Internal error");

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toContain("invalid_request_error");
    expect(placeholder?.message).toContain("requires a newer version of Codex");
  });

  it("renders a visible error (not an empty bubble) when the backend reports auth required", async () => {
    const mock = makeMockBackend();
    mock.prompt.mockRejectedValueOnce(new AuthRequiredError("You're not signed in to Claude."));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });

    await expect(session.sendPrompt("hi").turn).rejects.toBeInstanceOf(AuthRequiredError);

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toContain("not signed in to Claude");
    expect(session.getStatus()).toBe("error");
  });

  it("agent_message_chunk is appended to placeholder displayText", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    });
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: ", world." },
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.message).toBe("Hello, world.");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("appends a content chunk that trails past the prompt result (messageId race)", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");

    // Chunk delivered before the result.
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: "Hello" },
      },
    });
    // The backend flushes the result while the last chunk is still in flight.
    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
    // Trailing chunk for the same message arrives after the turn settled.
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: ", world." },
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.message).toBe("Hello, world.");
  });

  it("routes a trailing chunk to its own message, not a newer turn", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    // Turn A streams under messageId msg-a, then the result is flushed early.
    const { turn: turnA } = session.sendPrompt("first");
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-a",
        content: { type: "text", text: "A-before" },
      },
    });
    resolvePrompt!({ stopReason: "end_turn" });
    await turnA;

    // Turn B begins before A's trailing chunk lands.
    const { turn: turnB } = session.sendPrompt("second");
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-b",
        content: { type: "text", text: "B-text" },
      },
    });
    // A's late chunk must follow msg-a to A's message, not append to B.
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-a",
        content: { type: "text", text: "A-after" },
      },
    });

    const ai = session.store.getDisplayMessages().filter((m) => m.sender === AI_SENDER);
    expect(ai[0]?.message).toBe("A-beforeA-after");
    expect(ai[1]?.message).toBe("B-text");

    resolvePrompt!({ stopReason: "end_turn" });
    await turnB;
  });

  it("tool_call followed by tool_call_update merges into a single part", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "Read README",
        kind: "read",
        status: "pending",
        rawInput: { path: "README.md" },
      },
    });
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "file contents" } }],
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.parts).toHaveLength(1);
    expect(placeholder?.parts?.[0]).toMatchObject({
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "completed",
      output: [{ type: "text", text: "file contents" }],
    });

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  // Emit one completed tool call with `text` output and return the stored output.
  const storedToolOutput = async (text: string): Promise<AgentToolCallOutput | undefined> => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "codex",
    });
    const { turn } = session.sendPrompt("hi");
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text } }],
      },
    });
    const part = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER)?.parts?.[0];
    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
    if (part?.kind !== "tool_call") throw new Error("expected tool_call part");
    return part.output?.[0];
  };

  it("stores a large (but under-cap) text tool output in full", async () => {
    const text = "x".repeat(100_000);
    // 100k is far below the 256k runaway backstop, so it's preserved verbatim.
    expect(await storedToolOutput(text)).toEqual({ type: "text", text });
  });

  it("trims a runaway tool output above the backstop, noting the agent got it all", async () => {
    const output = await storedToolOutput("y".repeat(300_000));
    if (output?.type !== "text") throw new Error("expected text output");
    expect(output.text.length).toBeLessThan(300_000);
    expect(output.text).toContain("Display trimmed");
    expect(output.text).toContain("The agent received the full output");
  });

  it("cancel() sends cancel and aborts local controller", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "cancelled" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");
    await session.cancel();
    expect(mock.cancel).toHaveBeenCalledWith({ sessionId: "acp-1" });
    resolvePrompt!({ stopReason: "cancelled" });
    expect(await turn).toBe("cancelled");
  });
});

describe("withReadOnlyPreamble", () => {
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

describe("AgentSession fan-out branching", () => {
  it("dispatches to the fan-out runner (not backend.prompt) when >1 agent", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "opencode answer" },
          claude: { backendId: "claude", status: "done", text: "claude answer" },
        },
        summary: { status: "pending", text: "" },
      };
      input.onChange(turn);
      return turn;
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    const stopReason = await session.sendPrompt("review", undefined, undefined, [
      "opencode",
      "claude",
    ]).turn;

    expect(stopReason).toBe("end_turn");
    expect(runFanoutTurn).toHaveBeenCalledTimes(1);
    expect(mock.prompt).not.toHaveBeenCalled();
    // Every agent received the identical prompt blocks, led by the read-only
    // QA preamble (the universal "answer only, no writes" instruction).
    expect(runFanoutTurn.mock.calls[0][0].agents).toEqual(["opencode", "claude"]);
    // The summarizer is ALWAYS the session's own main agent (here it is also one
    // of the answerers because it was explicitly `@`-mentioned).
    expect(runFanoutTurn.mock.calls[0][0].mainAgent).toBe("opencode");
    const fanoutPrompt = runFanoutTurn.mock.calls[0][0].prompt[0] as { type: "text"; text: string };
    expect(fanoutPrompt.text).toContain("read-only");
    expect(fanoutPrompt.text).toContain("review");
    // Live per-agent answers ride on the assistant message itself (message.fanout),
    // surfaced through the display view for the UI dropdown.
    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.fanout?.answers.claude.text).toBe("claude answer");
  });

  it("persists the full composite (summary + per-agent answers + markers) and keeps the live turn on the message", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "OPENCODE_ANSWER" },
          claude: { backendId: "claude", status: "done", text: "CLAUDE_ANSWER" },
        },
        summary: { status: "done", text: "the narrative summary" },
      };
      input.onChange(turn);
      return turn;
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    await session.sendPrompt("review", undefined, undefined, ["opencode", "claude"]).turn;

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    // Phase 2: the persisted body is the FULL composite so the dropdown is
    // reconstructable on reload — summary AND per-agent answers AND the invisible
    // section markers all ride in the message body.
    expect(placeholder?.message).toContain("<!--copilot:multi-agent v=1-->");
    expect(placeholder?.message).toContain("the narrative summary");
    expect(placeholder?.message).toContain("OPENCODE_ANSWER");
    expect(placeholder?.message).toContain("CLAUDE_ANSWER");
    // The live turn rides on the message itself for the UI.
    expect(placeholder?.fanout?.summary.text).toBe("the narrative summary");
  });
});

describe("AgentSession fan-out paywall (send-boundary entitlement)", () => {
  const mockedEnsure = ensureMultiAgentEntitlement as jest.MockedFunction<
    typeof ensureMultiAgentEntitlement
  >;
  const mockedPrompt = showMultiAgentUpgradePrompt as jest.MockedFunction<
    typeof showMultiAgentUpgradePrompt
  >;

  const fanoutRunner = () =>
    jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "a" },
          claude: { backendId: "claude", status: "done", text: "b" },
        },
        summary: { status: "done", text: "summary" },
      };
      input.onChange(turn);
      return turn;
    });

  beforeEach(() => {
    // Default state: entitled. Individual tests override as needed.
    mockedEnsure.mockReset();
    mockedEnsure.mockResolvedValue(true);
    mockedPrompt.mockReset();
  });

  it("allows the fan-out for an entitled user (gate returns true) and runs the runner", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = fanoutRunner();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    const stopReason = await session.sendPrompt("review", undefined, undefined, [
      "opencode",
      "claude",
    ]).turn;

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    expect(mockedPrompt).not.toHaveBeenCalled();
    expect(runFanoutTurn).toHaveBeenCalledTimes(1);
    expect(stopReason).toBe("end_turn");
  });

  it("BLOCKS the fan-out for a non-entitled user: no runner, upgrade prompt shown, turn refused", async () => {
    mockedEnsure.mockResolvedValue(false);
    const mock = makeMockBackend();
    const runFanoutTurn = fanoutRunner();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    const stopReason = await session.sendPrompt("review", undefined, undefined, [
      "opencode",
      "claude",
    ]).turn;

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    // Hard stop: the fan-out runner never ran, and there was NO silent
    // single-agent fallback to backend.prompt.
    expect(runFanoutTurn).not.toHaveBeenCalled();
    expect(mock.prompt).not.toHaveBeenCalled();
    // The upgrade prompt surfaced.
    expect(mockedPrompt).toHaveBeenCalledTimes(1);
    // The turn settled as a refusal and the session is usable again (idle), with
    // no dangling streaming placeholder.
    expect(stopReason).toBe("refusal");
    expect(session.getStatus()).toBe("idle");

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toContain("Copilot Plus");
    expect(placeholder?.fanout).toBeUndefined();
  });

  it("does NOT trigger the gate for a non-fan-out (single-agent) turn", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = jest.fn();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    // No mentioned agents -> single-agent path; the paywall must never run.
    await session.sendPrompt("hi").turn;
    // Only the main agent @-ed -> collapses to single-agent; also no gate.
    await session.sendPrompt("hi again", undefined, undefined, ["opencode"]).turn;

    expect(mockedEnsure).not.toHaveBeenCalled();
    expect(mockedPrompt).not.toHaveBeenCalled();
    expect(runFanoutTurn).not.toHaveBeenCalled();
    expect(mock.prompt).toHaveBeenCalledTimes(2);
  });
});

describe("ensureMultiAgentEntitlement (paywall helper)", () => {
  // These exercise the REAL helper against mocked isPlusEnabled/BrevilabsClient,
  // verifying the fast path takes no network call and the slow path re-verifies.
  const validateLicenseKey = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    validateLicenseKey.mockReset();
  });

  async function loadHelper(
    isPlus: boolean
  ): Promise<(app?: unknown, ctx?: Record<string, unknown>) => Promise<boolean>> {
    jest.doMock("@/plusUtils", () => jest.requireActual("@/plusUtils"));
    jest.doMock("@/logger", () => ({
      logInfo: jest.fn(),
      logWarn: jest.fn(),
      logError: jest.fn(),
    }));
    jest.doMock("@/settings/model", () => ({
      getSettings: jest.fn().mockReturnValue({ isPlusUser: isPlus, enableSelfHostMode: false }),
      setSettings: jest.fn(),
      updateSetting: jest.fn(),
      useSettingsValue: jest.fn(),
    }));
    jest.doMock("@/LLMProviders/brevilabsClient", () => ({
      BrevilabsClient: { getInstance: () => ({ validateLicenseKey }) },
    }));
    const mod = await import("@/plusUtils");
    return mod.ensureMultiAgentEntitlement;
  }

  it("fast path: a cached Plus user is allowed with NO network call", async () => {
    const ensure = await loadHelper(true);
    await expect(ensure()).resolves.toBe(true);
    expect(validateLicenseKey).not.toHaveBeenCalled();
  });

  it("slow path: a stale-false cache that the backend confirms paid is allowed", async () => {
    validateLicenseKey.mockResolvedValue({ isValid: true });
    const ensure = await loadHelper(false);
    await expect(ensure()).resolves.toBe(true);
    expect(validateLicenseKey).toHaveBeenCalledTimes(1);
    // The feature context is forwarded for backend telemetry/upsell.
    expect(validateLicenseKey.mock.calls[0][1]).toMatchObject({ feature: "multi_agent_per_turn" });
  });

  it("slow path: a genuinely free user is blocked (isValid false)", async () => {
    validateLicenseKey.mockResolvedValue({ isValid: false });
    const ensure = await loadHelper(false);
    await expect(ensure()).resolves.toBe(false);
  });
});

describe("AgentSession fan-out conversation history", () => {
  /** A fan-out runner returning the given summary; captures its input prompt. */
  const fanoutWithSummary = (summary: string) =>
    jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "a" },
          claude: { backendId: "claude", status: "done", text: "b" },
        },
        summary: { status: "done", text: summary, complete: true },
      };
      input.onChange(turn);
      return turn;
    });

  const fanoutPromptText = (runFanoutTurn: jest.Mock): { type: "text"; text: string } =>
    runFanoutTurn.mock.calls[0][0].prompt[0] as { type: "text"; text: string };

  it("includes the prior transcript as a conversation_history block on a fan-out follow-up", async () => {
    const mock = makeMockBackend();
    // First a single-agent turn so a prior transcript exists.
    const runFanoutTurn = fanoutWithSummary("summary");
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    await session.sendPrompt("what is the master plan").turn;
    // Simulate the assistant's prior reply landing in the transcript.
    session.store.appendAgentText(
      session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER)!.id,
      "the master plan is X"
    );

    await session.sendPrompt("expand on that plan", undefined, undefined, ["opencode", "claude"])
      .turn;

    const text = fanoutPromptText(runFanoutTurn).text;
    expect(text).toContain("<conversation_history>");
    expect(text).toContain("what is the master plan");
    expect(text).toContain("the master plan is X");
    // The current question follows the history, inside the user-message block.
    expect(text).toContain("<user-message>\nexpand on that plan\n</user-message>");
    // The current in-flight user message is NOT duplicated inside history.
    expect((text.match(/expand on that plan/g) ?? []).length).toBe(1);
  });
});

describe("AgentSession fan-out follow-up continuity", () => {
  /** A fan-out runner that returns a turn with the given summary text. */
  const fanoutWithSummary = (summary: string) =>
    jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "a" },
          claude: { backendId: "claude", status: "done", text: "b" },
        },
        summary: { status: "done", text: summary, complete: true },
      };
      input.onChange(turn);
      return turn;
    });

  /**
   * A fan-out runner whose agents answered successfully but whose summary never
   * produced text (summary generation threw / ended empty). The persisted body
   * must fall back to a note, never a blank bubble.
   */
  const fanoutAnswersNoSummary = () =>
    jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
      const turn: FanoutTurn = {
        answers: {
          opencode: { backendId: "opencode", status: "done", text: "answer a" },
          claude: { backendId: "claude", status: "done", text: "answer b" },
        },
        summary: { status: "done", text: "" },
      };
      input.onChange(turn);
      return turn;
    });

  const lastPromptText = (mock: ReturnType<typeof makeMockBackend>): string => {
    const calls = mock.prompt.mock.calls;
    const last = calls[calls.length - 1][0] as { prompt: Array<{ text: string }> };
    return last.prompt[0].text;
  };

  it("injects the buffered question + summary on the next single-agent turn, then clears", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = fanoutWithSummary("the fan-out summary");
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    await session.sendPrompt("compare X and Y", undefined, undefined, ["opencode", "claude"]).turn;
    expect(mock.prompt).not.toHaveBeenCalled();

    await session.sendPrompt("now expand on that").turn;

    const text = lastPromptText(mock);
    expect(text).toContain("<prior_turns>");
    expect(text).toContain("compare X and Y");
    expect(text).toContain("the fan-out summary");
    expect(text).toContain("<user-message>\nnow expand on that\n</user-message>");

    // Buffer cleared: a second single-agent turn carries no prior-turn block.
    await session.sendPrompt("and again").turn;
    expect(lastPromptText(mock)).not.toContain("<prior_turns>");
  });

  it("replays the agents' answers when they answered but no summary was generated", async () => {
    const mock = makeMockBackend();
    const runFanoutTurn = fanoutAnswersNoSummary();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      runFanoutTurn,
    });

    await session.sendPrompt("multi question", undefined, undefined, ["opencode", "claude"]).turn;
    await session.sendPrompt("follow-up").turn;

    // No summary was generated, but agents answered — so the follow-up replays
    // the readable answers themselves (not a generic 'unavailable' note), so a
    // question like "what did they say?" still has the content the user saw.
    const text = lastPromptText(mock);
    expect(text).toContain("<prior_turns>");
    expect(text).toContain("multi question");
    expect(text).toContain("answer a");
    expect(text).toContain("answer b");
    expect(text).not.toContain("a combined summary could not be generated");
  });
});

describe("AgentSession.create (via start)", () => {
  it("captures `state.model` from newSession and exposes via getState", async () => {
    const mock = makeMockBackend();
    const stateWithModel: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithModel });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.ready;
    expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");
    expect(session.getState()?.model?.availableModels).toHaveLength(2);
  });

  it("getState returns null-model when the agent doesn't report models", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: emptyState() });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.ready;
    expect(session.getState()?.model).toBeNull();
  });

  it("attempts setModel when defaultModelSelection is set", async () => {
    const mock = makeMockBackend();
    const stateWithSonnet: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
      getDescriptor: () => makeWireOnlyDescriptor(),
    });
    await session.ready;
    expect(mock.setSessionModel).toHaveBeenCalledWith({
      sessionId: "acp-1",
      modelId: "openai/gpt-5",
    });
  });

  it("applyModelWireId routes through set_config_option when the catalog is config-option-backed", async () => {
    const mock = makeMockBackend();
    const configBackedState: BackendState = {
      model: {
        current: { baseModelId: "omlx/a", effort: null },
        apply: { kind: "setConfigOption", configId: "model" },
        availableModels: [{ baseModelId: "omlx/a", name: "A", provider: null, effortOptions: [] }],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: configBackedState });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.ready;
    await session.applyModelWireId("omlx/b");
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "model",
      value: "omlx/b",
    });
    expect(mock.setSessionModel).not.toHaveBeenCalled();
  });

  it("applyModelWireId routes through set_model when the catalog is models-backed", async () => {
    const mock = makeMockBackend();
    const modelsBackedState: BackendState = {
      model: {
        current: { baseModelId: "gpt-5", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          { baseModelId: "gpt-5", name: "GPT-5", provider: null, effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: modelsBackedState });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "codex",
    });
    await session.ready;
    await session.applyModelWireId("o3");
    expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "o3" });
    expect(mock.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it("seeds currentState with the persisted selection before notifying listeners", async () => {
    const mock = makeMockBackend();
    const stateWithSonnet: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
    // Block setSessionModel so the seed must survive on its own — without
    // the optimistic seed the picker would see "anthropic/sonnet" first.
    let resolveSetModel: ((s: BackendState) => void) | null = null;
    mock.setSessionModel.mockImplementationOnce(
      () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
    );
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
      getDescriptor: () => makeWireOnlyDescriptor(),
    });

    const observed: Array<string | undefined> = [];
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged: () => observed.push(session.getState()?.model?.current.baseModelId),
    });

    // Wait for the first notifyModelChanged inside initialize.
    await Promise.resolve();
    await Promise.resolve();
    expect(observed[0]).toBe("openai/gpt-5");

    resolveSetModel!(stateWithSonnet);
    await session.ready;
  });

  it("eagerly seeds currentState from initialCachedState before newSession resolves", async () => {
    const mock = makeMockBackend();
    const cachedState: BackendState = {
      model: {
        current: { baseModelId: "kimi-2.6", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          { baseModelId: "kimi-2.6", name: "Kimi 2.6", provider: "moon", effortOptions: [] },
          {
            baseModelId: "big-pickle",
            name: "Big Pickle",
            provider: "moon",
            effortOptions: [],
          },
        ],
      },
      mode: null,
    };
    // Block newSession so we can observe the pre-initialize state.
    let resolveNewSession: ((r: { sessionId: string; state: BackendState }) => void) | null = null;
    mock.newSession.mockImplementationOnce(
      () =>
        new Promise<{ sessionId: string; state: BackendState }>(
          (resolve) => (resolveNewSession = resolve)
        )
    );
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelSelection: { baseModelId: "big-pickle", effort: null },
      initialCachedState: cachedState,
      getDescriptor: () => makeWireOnlyDescriptor(),
    });

    // Before newSession resolves, getState reflects the eager seed
    // (current = big-pickle) rather than the cached current (kimi-2.6).
    expect(session.getState()?.model?.current.baseModelId).toBe("big-pickle");

    resolveNewSession!({ sessionId: "acp-1", state: cachedState });
    await session.ready;
  });

  it("applies a seeded effort via setConfigOption without a redundant setModel", async () => {
    // A cross-backend seed carrying a drafted effort must be applied through
    // the descriptor's channel. For descriptor-style backends where effort
    // lives outside the wire id, the base is unchanged so no setModel fires,
    // but the drafted effort still reaches the backend via setConfigOption.
    const mock = makeMockBackend();
    const backendState: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: "low" },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: backendState });
    mock.setSessionConfigOption.mockResolvedValueOnce({
      model: {
        ...backendState.model!,
        current: { baseModelId: "anthropic/sonnet", effort: "high" },
      },
      mode: null,
    });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "claude",
      defaultModelSelection: { baseModelId: "anthropic/sonnet", effort: "high" },
      // Descriptor whose wire encoding ignores effort (Claude-style).
      getDescriptor: () => makeDescriptorWireWithoutEffort(),
    });
    await session.ready;
    // baseModelId matches → no setModel call needed.
    expect(mock.setSessionModel).not.toHaveBeenCalled();
    // The drafted effort is dispatched through the config-option channel.
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "effort",
      value: "high",
    });
    expect(session.getState()?.model?.current.effort).toBe("high");
  });

  it("reverts the seeded selection when setModel fails", async () => {
    const mock = makeMockBackend();
    const stateWithSonnet: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
      getDescriptor: () => makeWireOnlyDescriptor(),
    });
    await session.ready;
    expect(session.getStatus()).toBe("idle");
    // Seed reverted to whatever the backend actually reported.
    expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");
  });

  it("seeds config-option opencode effort via the effort option, not the model id", async () => {
    // Regression: a cross-backend pick to config-option opencode (≥1.15.13)
    // must set the bare model on the model config option and the effort on the
    // separate effort option. Packing `base/effort` into the model option (the
    // old applyModelWireId path) would start the session at the model default
    // effort or fail, and opencode has no applyInitialSessionConfig to fix it.
    const mock = makeMockBackend();
    // The fresh session reports a different model than the drafted pick, so the
    // bare-model switch is exercised before the effort write.
    const gpt5Entry = {
      baseModelId: "openai/gpt-5",
      name: "GPT-5",
      provider: "openai",
      effortOptions: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    };
    const reportedState: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          gpt5Entry,
        ],
      },
      mode: null,
    };
    const switchedState: BackendState = {
      model: {
        current: { baseModelId: "openai/gpt-5", effort: null },
        apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
        availableModels: [reportedState.model!.availableModels[0], gpt5Entry],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: reportedState });
    // First config write switches the bare model (refreshing the effort
    // option), the second lands the effort on `thought_level`.
    mock.setSessionConfigOption
      .mockResolvedValueOnce(switchedState)
      .mockResolvedValue(switchedState);

    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: "high" },
      getDescriptor: () => makeConfigOptionDescriptor(),
    });
    await session.ready;

    // Never the model channel.
    expect(mock.setSessionModel).not.toHaveBeenCalled();
    // The bare model id is set on the model option (no effort suffix)…
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "model",
      value: "openai/gpt-5",
    });
    // …and the drafted effort is set on the effort option.
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "thought_level",
      value: "high",
    });
  });

  it("resets effort to native when seeding null effort over a stale concrete effort", async () => {
    // Regression: a config-option opencode process baked `model/high`, the user
    // cleared the default effort to agent default, and a fresh session reports
    // the same base but the stale "high". applySelection skips the model write
    // (base matches) and returns for null effort, so the chat would stay on
    // "high". The bare model option must be re-written to reset effort.
    const mock = makeMockBackend();
    const entry = {
      baseModelId: "openai/gpt-5",
      name: "GPT-5",
      provider: "openai",
      effortOptions: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    };
    const staleState: BackendState = {
      model: {
        current: { baseModelId: "openai/gpt-5", effort: "high" },
        apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
        availableModels: [entry],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: staleState });
    mock.setSessionConfigOption.mockResolvedValue({
      model: { ...staleState.model!, current: { baseModelId: "openai/gpt-5", effort: "low" } },
      mode: null,
    });

    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      // Cleared effort → agent default (null), same model as the stale report.
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
      getDescriptor: () => makeConfigOptionDescriptor(),
    });
    await session.ready;

    // The bare model is re-written to reset effort; no effort value is sent.
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "model",
      value: "openai/gpt-5",
    });
    expect(mock.setSessionConfigOption).not.toHaveBeenCalledWith(
      expect.objectContaining({ configId: "thought_level" })
    );
  });
});

/** Minimal wire-only descriptor for tests that exercise seed/setModel. */
function makeWireOnlyDescriptor(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) =>
      selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  };
  return {
    wire,
    // Suffix-style backend: effort rides in the wire id, so applying the
    // encoded selection through the model channel is sufficient.
    applySelection: (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => session.applyModelWireId(wire.encode(selection)),
  } as unknown as BackendDescriptor;
}

/**
 * Descriptor mirroring config-option opencode (≥1.15.13): the model lives on a
 * `model` config option and effort on a sibling `thought_level` option, applied
 * after the bare model. Effort is never packed into the model wire id.
 */
function makeConfigOptionDescriptor(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) =>
      selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  };
  return {
    wire,
    applySelection: async (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => {
      const apply = session.getState()?.model?.apply;
      if (apply?.kind === "setConfigOption" && apply.effortConfigId) {
        const currentBase = session.getState()?.model?.current.baseModelId;
        if (currentBase !== selection.baseModelId) {
          await session.applyModelWireId(
            wire.encode({ baseModelId: selection.baseModelId, effort: null })
          );
        }
        if (selection.effort !== null) {
          const refreshed = session.getState()?.model?.apply;
          const effortConfigId =
            refreshed?.kind === "setConfigOption" ? refreshed.effortConfigId : undefined;
          if (effortConfigId) await session.setConfigOption(effortConfigId, selection.effort);
        }
        return;
      }
      await session.applyModelWireId(wire.encode(selection));
    },
  } as unknown as BackendDescriptor;
}

describe("AgentSession warm-adoption ready gating", () => {
  it("ready stays pending until setModel resolves so sendPrompt can't fire on the probe model", async () => {
    const mock = makeMockBackend();
    const probeState: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    // Block setSessionModel so we can observe `ready` remaining pending.
    let resolveSetModel!: (s: BackendState) => void;
    mock.setSessionModel.mockImplementationOnce(
      () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
    );

    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "probe-1",
      internalId: "internal-1",
      backendId: "opencode",
      initialState: probeState,
      defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
      getDescriptor: () => makeWireOnlyDescriptor(),
    });

    let readyResolved = false;
    void session.ready.then(() => {
      readyResolved = true;
    });
    await new Promise((r) => window.setTimeout(r, 0));
    expect(readyResolved).toBe(false);
    expect(mock.setSessionModel).toHaveBeenCalledWith({
      sessionId: "probe-1",
      modelId: "openai/gpt-5",
    });

    resolveSetModel({
      model: {
        ...probeState.model!,
        current: { baseModelId: "openai/gpt-5", effort: null },
      },
      mode: null,
    });
    await session.ready;
    expect(readyResolved).toBe(true);
    expect(session.getState()?.model?.current.baseModelId).toBe("openai/gpt-5");
  });

  it("ready resolves immediately when no default selection is supplied", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "probe-1",
      internalId: "internal-1",
      backendId: "opencode",
      initialState: emptyState(),
    });
    await session.ready;
    expect(mock.setSessionModel).not.toHaveBeenCalled();
  });
});

/**
 * Descriptor whose wire encoding ignores effort (Claude SDK-style). Used
 * to exercise the "effort lives out-of-band" branch where `setModel`
 * would be a no-op and effort is applied via `applyInitialSessionConfig`.
 */
function makeDescriptorWireWithoutEffort(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) => selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
    effortConfigFor: () => ({ id: "effort", kind: "select" }),
  };
  return {
    wire,
    // Claude-style: effort lives outside the wire id, so the model channel
    // carries only the base id and effort goes through setConfigOption.
    applySelection: async (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => {
      const currentBase = session.getState()?.model?.current.baseModelId;
      if (currentBase !== selection.baseModelId)
        await session.applyModelWireId(wire.encode(selection));
      if (selection.effort !== null) await session.setConfigOption("effort", selection.effort);
    },
  } as unknown as BackendDescriptor;
}

describe("AgentSession.setModel", () => {
  it("calls backend.setSessionModel and replaces the cached state on success", async () => {
    const mock = makeMockBackend();
    const newState: BackendState = {
      model: {
        current: { baseModelId: "x/y", effort: null },
        apply: { kind: "setModel" },
        availableModels: [{ baseModelId: "x/y", name: "X Y", provider: null, effortOptions: [] }],
      },
      mode: null,
    };
    mock.setSessionModel.mockResolvedValueOnce(newState);
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.setModel("x/y");
    expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "x/y" });
    expect(session.getState()?.model?.current.baseModelId).toBe("x/y");
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await expect(session.setModel("x/y")).rejects.toBeInstanceOf(MethodUnsupportedError);
    expect(session.getState()).toBeNull();
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setModel("x/y");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession.setConfigOption", () => {
  it("forwards to backend and replaces state from response", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockResolvedValueOnce(emptyState());
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    await session.setConfigOption("effort", "high");
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "effort",
      value: "high",
    });
  });

  it("notifies onModelChanged subscribers on success", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setConfigOption("effort", "low");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });

  it("rethrows MethodUnsupportedError without notifying", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockRejectedValueOnce(
      new MethodUnsupportedError("session/set_config_option")
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await expect(session.setConfigOption("effort", "high")).rejects.toBeInstanceOf(
      MethodUnsupportedError
    );
    expect(onModelChanged).not.toHaveBeenCalled();
  });
});

describe("AgentSession.setMode", () => {
  it("calls backend.setSessionMode and replaces state on success", async () => {
    const mock = makeMockBackend();
    mock.setSessionMode.mockResolvedValueOnce(emptyState());
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    await session.setMode("plan");
    expect(mock.setSessionMode).toHaveBeenCalledWith({ sessionId: "acp-1", modeId: "plan" });
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionMode.mockRejectedValueOnce(new MethodUnsupportedError("session/set_mode"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    await expect(session.setMode("plan")).rejects.toBeInstanceOf(MethodUnsupportedError);
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setMode("plan");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession state_changed event", () => {
  it("swaps cached state and notifies onModelChanged", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    const newState: BackendState = {
      model: null,
      mode: { current: "plan", options: [{ value: "plan", label: "Plan" }], apply: {} },
    };
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "state_changed", state: newState },
    });
    expect(session.getState()).toBe(newState);
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession intent capabilities", () => {
  function makeDescriptor(opts: {
    descriptorStyleEffort?: boolean;
  }): () => BackendDescriptor | undefined {
    const descriptor = {
      id: "test-backend",
      displayName: "Test",
      wire: {
        encode: () => "",
        decode: () => ({ selection: { baseModelId: "", effort: null }, provider: null }),
        ...(opts.descriptorStyleEffort
          ? {
              effortConfigFor: () => ({
                id: "reasoning_effort",
                label: "Effort",
                values: [],
              }),
            }
          : {}),
      },
    } as unknown as BackendDescriptor;
    return () => descriptor;
  }

  function sessionWith(opts: {
    isModelSwitchSupported: boolean | null;
    isSetSessionConfigOptionSupported: boolean | null;
    isSetModeSupported: boolean | null;
    descriptorStyleEffort?: boolean;
    initialState?: BackendState;
  }): AgentSession {
    const mock = makeMockBackend();
    mock.asBackend.isSetSessionModelSupported = () => opts.isModelSwitchSupported;
    mock.asBackend.isSetSessionConfigOptionSupported = () => opts.isSetSessionConfigOptionSupported;
    mock.asBackend.isSetSessionModeSupported = () => opts.isSetModeSupported;
    return new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "test-backend",
      initialState: opts.initialState ?? null,
      getDescriptor: makeDescriptor({ descriptorStyleEffort: opts.descriptorStyleEffort }),
    });
  }

  it("canSwitchModel mirrors the underlying model-switch probe", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: true,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: false,
      }).canSwitchModel()
    ).toBe(true);
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchModel()
    ).toBe(false);
    expect(
      sessionWith({
        isModelSwitchSupported: null,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchModel()
    ).toBeNull();
  });

  it("canSwitchEffort returns the setConfigOption probe for descriptor-style backends", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: false,
        descriptorStyleEffort: true,
      }).canSwitchEffort()
    ).toBe(true);
  });

  it("canSwitchEffort returns the model-switch probe for suffix-style backends", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: true,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: false,
        descriptorStyleEffort: false,
      }).canSwitchEffort()
    ).toBe(true);
  });

  it("canSwitchMode returns null when no mode state is reported", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchMode()
    ).toBeNull();
  });

  it("canSwitchMode samples the first option's apply spec — setConfigOption", () => {
    const state: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setConfigOption", configId: "mode", value: "plan" } },
      },
    };
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: false,
        initialState: state,
      }).canSwitchMode()
    ).toBe(true);
  });

  it("canSwitchMode samples the first option's apply spec — setMode", () => {
    const state: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setMode", nativeId: "plan" } },
      },
    };
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: true,
        initialState: state,
      }).canSwitchMode()
    ).toBe(true);
  });

  it("canSwitch* return false while the session status is starting", async () => {
    const mock = makeMockBackend();
    // Keep newSession pending so status stays "starting".
    let resolveNew: ((value: { sessionId: string; state: BackendState }) => void) | null = null;
    mock.newSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNew = resolve;
      })
    );
    mock.asBackend.isSetSessionModelSupported = () => true;
    mock.asBackend.isSetSessionConfigOptionSupported = () => true;
    mock.asBackend.isSetSessionModeSupported = () => true;
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "test-backend",
      getDescriptor: () => undefined,
    });
    expect(session.getStatus()).toBe("starting");
    expect(session.canSwitchModel()).toBe(false);
    expect(session.canSwitchEffort()).toBe(false);
    expect(session.canSwitchMode()).toBe(false);

    // After ready, the gate lifts and the underlying probes drive the answer.
    resolveNew!({
      sessionId: "acp-1",
      state: {
        model: null,
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      },
    });
    await session.ready;
    expect(session.canSwitchModel()).toBe(true);
    expect(session.canSwitchMode()).toBe(true);
  });
});

describe("AgentSession.setLabel", () => {
  it("stores trimmed label and notifies onLabelChanged", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onLabelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onLabelChanged,
    });

    session.setLabel("  My session  ");
    expect(session.getLabel()).toBe("My session");
    expect(onLabelChanged).toHaveBeenCalledTimes(1);

    session.setLabel("   ");
    expect(session.getLabel()).toBeNull();
    expect(onLabelChanged).toHaveBeenCalledTimes(2);

    session.setLabel(null);
    expect(onLabelChanged).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSession needsAttention flag", () => {
  it("starts cleared and flips on mark / clear with one notification each", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onNeedsAttentionChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onNeedsAttentionChanged,
    });

    expect(session.getNeedsAttention()).toBe(false);

    session.markNeedsAttention();
    expect(session.getNeedsAttention()).toBe(true);
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);
    expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(true);

    // No-op: already true.
    session.markNeedsAttention();
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);

    session.clearNeedsAttention();
    expect(session.getNeedsAttention()).toBe(false);
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
    expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(false);

    // No-op: already false.
    session.clearNeedsAttention();
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSession session_info_update", () => {
  it("adopts the title pushed by the agent and notifies listeners", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onLabelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onLabelChanged,
    });

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Refactor auth" },
    });

    expect(session.getLabel()).toBe("Refactor auth");
    expect(onLabelChanged).toHaveBeenCalledTimes(1);
  });

  it("ignores agent-pushed titles after the user has renamed the session", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.setLabel("My label");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Agent-chosen title" },
    });

    expect(session.getLabel()).toBe("My label");
  });

  it("does not require an active turn placeholder", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Idle title" },
    });
    expect(session.getLabel()).toBe("Idle title");
  });

  it("a null/empty agent title clears the label and re-opens it for future agent updates", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "First" },
    });
    expect(session.getLabel()).toBe("First");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: null },
    });
    expect(session.getLabel()).toBeNull();

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Second" },
    });
    expect(session.getLabel()).toBe("Second");
  });
});

describe("AgentSession title poll after turn", () => {
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("pulls the title via listSessions and applies it after end_turn", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [
        { sessionId: "acp-1", cwd: "/vault", title: "Refactor auth", updatedAt: null },
        { sessionId: "acp-other", cwd: "/vault", title: "Different session", updatedAt: null },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    const { turn } = session.sendPrompt("hi");
    await turn;
    await flushMicrotasks();

    expect(mock.listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    expect(session.getLabel()).toBe("Refactor auth");
  });

  it("ignores opencode's default 'New session - …' placeholder titles", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: "acp-1",
          cwd: "/vault",
          title: "New session - 2026-04-26T01:24:54.221Z",
          updatedAt: null,
        },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(session.getLabel()).toBeNull();
  });

  it("does not poll when the user has already renamed the session", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    session.setLabel("My label");
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
    expect(session.getLabel()).toBe("My label");
  });

  it("does not poll on cancelled turns", async () => {
    const mock = makeMockBackend();
    mock.prompt.mockResolvedValueOnce({ stopReason: "cancelled" });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
  });

  it("silently no-ops when the agent doesn't support listSessions", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockRejectedValueOnce(new MethodUnsupportedError("session/list"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(session.getLabel()).toBeNull();
  });

  it("omits cwd filter when the session has no cwd recorded", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: "acp-1", cwd: "/vault", title: "Found me", updatedAt: null }],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).toHaveBeenCalledWith({});
    expect(session.getLabel()).toBe("Found me");
  });
});

describe("AgentSession client-derived title (non-summarizing backends)", () => {
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function makeSession(backendId: "codex" | "claude" | "opencode", summarizes: boolean) {
    return new AgentSession({
      backend: makeMockBackend().asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId,
      getDescriptor: summarizes ? summarizingDescriptor : nonSummarizingDescriptor,
    });
  }

  it("derives the tab label from the first user message for codex", () => {
    const session = makeSession("codex", false);
    session.sendPrompt("Summarize my meeting notes");
    expect(session.getLabel()).toBe("Summarize my meeting notes");
    expect(session.getLabelSource()).toBe("agent");
  });

  it("derives the tab label from the first user message for Claude Code", () => {
    const session = makeSession("claude", false);
    session.sendPrompt("Refactor the auth module");
    expect(session.getLabel()).toBe("Refactor the auth module");
  });

  it("strips wikilink brackets when deriving the title", () => {
    const session = makeSession("codex", false);
    session.sendPrompt("Review [[Project Plan]] please");
    expect(session.getLabel()).toBe("Review Project Plan please");
  });

  it("keeps the first message's derived title across later turns", async () => {
    const session = makeSession("codex", false);
    await session.sendPrompt("First prompt").turn;
    expect(session.getLabel()).toBe("First prompt");
    await session.sendPrompt("A different second prompt").turn;
    expect(session.getLabel()).toBe("First prompt");
  });

  it("does not override a user rename with a derived title", () => {
    const session = makeSession("codex", false);
    session.setLabel("My rename");
    session.sendPrompt("Some prompt that would otherwise become the title");
    expect(session.getLabel()).toBe("My rename");
    expect(session.getLabelSource()).toBe("user");
  });

  it("does not derive a label for a summarizing backend (opencode)", () => {
    const session = makeSession("opencode", true);
    session.sendPrompt("This should not become the tab title");
    expect(session.getLabel()).toBeNull();
  });

  it("ignores a backend-pushed session_info_update title for non-summarizing backends", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "codex",
      getDescriptor: nonSummarizingDescriptor,
    });
    session.sendPrompt("Original user prompt");
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "<copilot-context> leaked title" },
    });
    expect(session.getLabel()).toBe("Original user prompt");
  });

  it("does not poll listSessions after a turn for non-summarizing backends", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "codex",
      cwd: "/vault",
      getDescriptor: nonSummarizingDescriptor,
    });
    await session.sendPrompt("hello").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
  });
});

describe("AgentSession plan proposal lifecycle", () => {
  it("does not resurrect the plan card when a late tool_call_update arrives for a finalized proposal", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("plan something");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-1",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: "# proposed plan body" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const initialPlan = session.getCurrentPlan();
    expect(initialPlan).not.toBeNull();
    expect(initialPlan?.decision).toBe("pending");
    expect(initialPlan?.pendingToolCallId).toBe("tc-plan-1");

    expect(session.finalizePlanDecision(initialPlan!.id)).toBe(true);
    expect(session.getCurrentPlan()).toBeNull();

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-plan-1",
        status: "completed",
        rawInput: { plan: "# proposed plan body" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    expect(session.getCurrentPlan()).toBeNull();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("propagates a body-identical setCurrentPlan when the gating state changes", async () => {
    // Regression: body-identical plan publications still need to propagate
    // control metadata such as pendingToolCallId. Otherwise a repeated
    // ExitPlanMode call can leave the UI resolving the wrong permission.
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("plan something");

    const planBody = "# proposed plan body";
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-A",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: planBody },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const first = session.getCurrentPlan();
    expect(first?.pendingToolCallId).toBe("tc-plan-A");
    expect(first?.permissionGated).toBe(true);
    expect(first?.revision).toBe(1);

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-B",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: planBody },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const second = session.getCurrentPlan();
    expect(second?.pendingToolCallId).toBe("tc-plan-B");
    expect(second?.permissionGated).toBe(true);
    // Body is byte-identical, so revision must NOT bump — the per-tab
    // `decided` reset effect in PlanPreviewView keys on revision and would
    // misfire if we treated this as an in-place content revision.
    expect(second?.revision).toBe(1);

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("does not promote completed plan-file writes into proposal cards", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
      initialState: {
        model: null,
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      },
      getDescriptor: () =>
        ({
          isPlanModePlanFilePath: (absolutePath: string) =>
            absolutePath === "/Users/test/.claude/plans/plan.md",
        }) as unknown as BackendDescriptor,
    });
    const { turn } = session.sendPrompt("plan something");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-plan-write",
        title: "Write",
        kind: "edit",
        status: "completed",
        rawInput: {
          file_path: "/Users/test/.claude/plans/plan.md",
          content: "# proposed plan body",
        },
      },
    });

    expect(session.getCurrentPlan()).toBeNull();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("publishes a gated plan from an ExitPlanMode permission request", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-from-permission",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: {
          plan: "# permission plan body",
          planFilePath: "/Users/test/.claude/plans/plan.md",
        },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    const plan = session.getCurrentPlan();
    expect(plan?.body).toBe("# permission plan body");
    expect(plan?.permissionGated).toBe(true);
    expect(plan?.pendingToolCallId).toBe("tc-plan-from-permission");
    expect(plan?.sourceFilePath).toBe("/Users/test/.claude/plans/plan.md");

    session.resolvePlanProposalPermission("tc-plan-from-permission", false);
    await decisionPromise;
  });

  it("marks an active turn as awaiting permission while an inline tool card is pending", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const statusChanges: string[] = [];
    session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => statusChanges.push(status),
    });
    const { turn } = session.sendPrompt("edit a file");
    expect(session.getStatus()).toBe("running");

    const decisionPromise = session.handleToolPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-write",
        kind: "edit",
        status: "pending",
        title: "Write",
        rawInput: { file_path: "note.md", content: "updated" },
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    expect(session.getStatus()).toBe("awaiting_permission");
    expect(session.getPendingToolPermissions()).toHaveLength(1);
    expect(statusChanges).toContain("awaiting_permission");

    session.resolveToolPermission("tc-write", "allow_once");
    await expect(decisionPromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    expect(session.getPendingToolPermissions()).toHaveLength(0);
    expect(session.getStatus()).toBe("running");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("rejects a pending inline tool permission before awaiting backend cancel", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "cancelled" }) => void) | null = null;
    let decisionPromise: Promise<unknown> = Promise.resolve();
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    mock.cancel.mockImplementation(() => decisionPromise.then(() => undefined));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("edit a file");

    decisionPromise = session.handleToolPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-write",
        kind: "edit",
        status: "pending",
        title: "Write",
        rawInput: { file_path: "note.md", content: "updated" },
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    const cancelPromise = session.cancel();
    await expect(decisionPromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject_once" },
    });
    expect(session.getPendingToolPermissions()).toHaveLength(0);
    await cancelPromise;

    resolvePrompt!({ stopReason: "cancelled" });
    await turn;
  });

  it("surfaces a pending AskUserQuestion and resolves it with the submitted answers", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const statusChanges: string[] = [];
    session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => statusChanges.push(status),
    });
    const { turn } = session.sendPrompt("ask me something");
    expect(session.getStatus()).toBe("running");

    const answersPromise = session.handleAskUserQuestion({
      sessionId: "acp-1",
      requestId: "tc-ask",
      questions: [{ question: "Pick a fruit", options: [{ label: "Apple" }, { label: "Pear" }] }],
    });

    expect(session.getStatus()).toBe("awaiting_permission");
    expect(session.getPendingAskUserQuestions()).toHaveLength(1);
    expect(statusChanges).toContain("awaiting_permission");

    session.resolveAskUserQuestion("tc-ask", { "Pick a fruit": "Pear" });
    await expect(answersPromise).resolves.toEqual({ "Pick a fruit": "Pear" });
    expect(session.getPendingAskUserQuestions()).toHaveLength(0);
    expect(session.getStatus()).toBe("running");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("returns the shared empty array when no AskUserQuestion is pending", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    expect(session.getPendingAskUserQuestions()).toHaveLength(0);
    // Stable reference across idle ticks so React subscribers don't re-render.
    expect(session.getPendingAskUserQuestions()).toBe(session.getPendingAskUserQuestions());
  });

  it("flushes a pending AskUserQuestion with empty answers when the turn is cancelled", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "cancelled" }) => void) | null = null;
    let answersPromise: Promise<unknown> = Promise.resolve();
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    mock.cancel.mockImplementation(() => answersPromise.then(() => undefined));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("ask me something");

    answersPromise = session.handleAskUserQuestion({
      sessionId: "acp-1",
      requestId: "tc-ask",
      questions: [{ question: "Pick a fruit", options: [{ label: "Apple" }] }],
    });
    expect(session.getStatus()).toBe("awaiting_permission");

    const cancelPromise = session.cancel();
    // Cancellation resolves the card's resolver with `{}` (the cancel signal)
    // so the SDK turn unblocks instead of dangling.
    await expect(answersPromise).resolves.toEqual({});
    expect(session.getPendingAskUserQuestions()).toHaveLength(0);
    await cancelPromise;

    resolvePrompt!({ stopReason: "cancelled" });
    await turn;
  });

  it("forwards the optional denyMessage on resolvePlanProposalPermission to the resolved decision", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("plan something");

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-deny-msg",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: { plan: "# x" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    session.resolvePlanProposalPermission("tc-plan-deny-msg", false, "please drop step 2");
    const decision = await decisionPromise;

    expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
    expect(decision.denyMessage).toBe("please drop step 2");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("does not attach denyMessage when allowing", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const { turn } = session.sendPrompt("plan something");

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-allow",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: { plan: "# x" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    session.resolvePlanProposalPermission("tc-plan-allow", true, "should be ignored");
    const decision = await decisionPromise;

    expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(decision.denyMessage).toBeUndefined();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });
});

describe("AgentSession status derivation", () => {
  it("reports 'error' after a failed turn and resets to 'running' on the next sendPrompt", async () => {
    const mock = makeMockBackend();
    mock.prompt.mockRejectedValueOnce(new Error("boom"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    await expect(session.sendPrompt("hi").turn).rejects.toThrow("boom");
    expect(session.getStatus()).toBe("error");

    // A fresh prompt should clear the prior turn error and report running.
    const { turn } = session.sendPrompt("retry");
    expect(session.getStatus()).toBe("running");
    await turn;
    expect(session.getStatus()).toBe("idle");
  });

  it("fires onStatusChanged exactly once per distinct transition through the permission lifecycle", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });
    const statusChanges: string[] = [];
    session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (status) => statusChanges.push(status),
    });

    const { turn } = session.sendPrompt("edit a file");
    const decisionPromise = session.handleToolPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-write",
        kind: "edit",
        status: "pending",
        title: "Write",
        rawInput: { file_path: "note.md", content: "updated" },
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });
    session.resolveToolPermission("tc-write", "allow_once");
    await decisionPromise;
    resolvePrompt!({ stopReason: "end_turn" });
    await turn;

    // running → awaiting_permission → running → idle, each fired once.
    expect(statusChanges).toEqual(["running", "awaiting_permission", "running", "idle"]);
  });
});

describe("tryReadExitPlanModeCall", () => {
  it("returns the plan body when isPlanProposal is true", () => {
    const out = tryReadExitPlanModeCall({
      kind: "other",
      rawInput: { plan: "# do the thing" },
      isPlanProposal: true,
    });
    expect(out).toEqual({ plan: "# do the thing", planFilePath: undefined });
  });

  it("falls back to ACP kind=switch_mode when isPlanProposal is unset", () => {
    const out = tryReadExitPlanModeCall({
      kind: "switch_mode",
      rawInput: { plan: "## plan body", planFilePath: "/abs/plan.md" },
    });
    expect(out).toEqual({ plan: "## plan body", planFilePath: "/abs/plan.md" });
  });

  it("returns null when rawInput.plan is missing — content gate is load-bearing", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { planFilePath: "/abs/plan.md" },
        isPlanProposal: true,
      })
    ).toBeNull();
  });

  it("returns null when rawInput.plan is not a string", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: 42 },
      })
    ).toBeNull();
  });

  it("returns null when neither isPlanProposal nor switch_mode kind matches", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "edit",
        rawInput: { plan: "looks like a plan but isn't tagged as one" },
      })
    ).toBeNull();
  });

  it("ignores planFilePath when it isn't a string", () => {
    const out = tryReadExitPlanModeCall({
      kind: "switch_mode",
      rawInput: { plan: "body", planFilePath: 12 },
    });
    expect(out).toEqual({ plan: "body", planFilePath: undefined });
  });

  it("handles null/undefined rawInput without throwing", () => {
    expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: null })).toBeNull();
    expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: undefined })).toBeNull();
  });
});

describe("AgentSession streamed-token notification coalescing", () => {
  // Controllable rAF: streaming notifications are rAF-batched, so we drive the
  // frame boundary manually to assert how many `onMessagesChanged` fires the
  // UI actually sees. Without this they'd coalesce on jsdom's timer and the
  // assertions would be timing-dependent.
  let rafQueue: FrameRequestCallback[];
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  const flushFrame = () => {
    const pending = rafQueue;
    rafQueue = [];
    for (const cb of pending) cb(performance.now());
  };

  beforeEach(() => {
    rafQueue = [];
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      rafQueue.push(cb);
      return rafQueue.length; // 1-based handle
    };
    window.cancelAnimationFrame = (handle: number): void => {
      const idx = handle - 1;
      if (idx >= 0 && idx < rafQueue.length) rafQueue.splice(idx, 1);
    };
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  const streamChunk = (mock: MockBackend, text: string) =>
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });

  it("collapses a burst of streamed chunks into one notification per frame", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    const onMessagesChanged = jest.fn();
    session.subscribe({ onMessagesChanged, onStatusChanged: () => {} });

    const { turn } = session.sendPrompt("hi");
    // The synchronous user-message + placeholder append notifies immediately so
    // the user's message paints within one frame — NOT rAF-deferred.
    expect(onMessagesChanged).toHaveBeenCalledTimes(1);

    // A fast token burst within one frame schedules a single rAF.
    onMessagesChanged.mockClear();
    streamChunk(mock, "Hel");
    streamChunk(mock, "lo");
    streamChunk(mock, ", world");
    // No notification yet — they were coalesced behind the frame.
    expect(onMessagesChanged).not.toHaveBeenCalled();
    // Store is updated synchronously regardless of the deferred notification.
    expect(session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER)?.message).toBe(
      "Hello, world"
    );

    flushFrame();
    // The whole burst collapsed into exactly one re-render.
    expect(onMessagesChanged).toHaveBeenCalledTimes(1);

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
    flushFrame();
  });

  it("always delivers the trailing turn-complete notification (no dropped final state)", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    const onMessagesChanged = jest.fn();
    session.subscribe({ onMessagesChanged, onStatusChanged: () => {} });

    const { turn } = session.sendPrompt("hi");
    onMessagesChanged.mockClear();

    // A chunk arrives and schedules a rAF that has NOT fired yet.
    streamChunk(mock, "partial");
    expect(rafQueue).toHaveLength(1);
    expect(onMessagesChanged).not.toHaveBeenCalled();

    // The turn completes before the scheduled frame runs. The turn-complete
    // notification must fire immediately (trailing edge) and cancel the stale
    // pending rAF so the message settles to its complete final state — even if
    // the browser never grants another animation frame.
    resolvePrompt!({ stopReason: "end_turn" });
    await turn;

    expect(onMessagesChanged).toHaveBeenCalled();
    // The pending streaming frame was cancelled by the immediate flush, so a
    // later frame can't fire a duplicate/stale notification.
    expect(rafQueue).toHaveLength(0);

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.message).toBe("partial");
    expect(placeholder?.turnStopReason).toBe("end_turn");
  });
});
