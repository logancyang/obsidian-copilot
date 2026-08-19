import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import ChatSingleMessage, {
  normalizeFootnoteRendering,
} from "@/components/chat-components/ChatSingleMessage";
import { ChatMessage } from "@/types/message";
import type { App } from "obsidian";
import { TooltipProvider } from "@/components/ui/tooltip";

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({
    enableInlineCitations: true,
    activeModels: [
      {
        name: "test-model",
        provider: "test-provider",
        enabled: true,
        capabilities: ["reasoning"],
      },
    ],
  })),
  getSettings: jest.fn(() => ({ debug: false })),
}));

jest.mock("@/aiParams", () => ({
  useModelKey: jest.fn(() => ["test-model|test-provider", jest.fn()]),
}));

jest.mock("@/LLMProviders/chainRunner/utils/toolCallParser", () => ({
  parseToolCallMarkers: jest.fn((message: string) => ({
    segments: [{ type: "text", content: message }],
  })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/citationUtils", () => ({
  processInlineCitations: jest.fn((content: string) => content),
}));

jest.mock("obsidian", () => {
  // Mirrors the modern `MarkdownRenderer.render(app, md, el, sourcePath, component)`
  // signature — `md` is the second argument, not the first.
  const render = jest.fn().mockResolvedValue(undefined);
  return {
    MarkdownRenderer: {
      render,
    },
    Component: class {
      load() {}
      unload() {}
      register(_cb: () => void) {}
    },
    MarkdownView: class {},
    TFile: class {},
    App: class {},
    ItemView: class {
      containerEl = document.createElement("div");
    },
    WorkspaceLeaf: class {},
    Platform: {
      isMobile: false,
    },
    Modal: class {
      open() {
        /* noop */
      }
      close() {
        /* noop */
      }
    },
    __renderMock: render,
  };
});

const { __renderMock: renderMarkdownMock } = jest.requireMock<{
  __renderMock: jest.Mock;
}>("obsidian");

// ---------------------------------------------------------------------------
// Verifies that the HTML string passed to MarkdownRenderer.renderMarkdown
// never has </div> or </details> on the same line as a 4-space-indented
// line. This was the root cause of the Gemma rendering bug: google/gemma-4-31b-it
// thinking output ends with 4-space-indented bullet points, and without a
// trailing \n the closing </div> was consumed by markdown's indented code
// block rule and rendered as literal "&lt;/div&gt;" text.
// ---------------------------------------------------------------------------

describe("think block rendering — closing tags are not consumed by indented code blocks", () => {
  const createAppStub = (): App =>
    ({
      workspace: { getActiveFile: jest.fn(() => null) },
      metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
    }) as unknown as App;

  const baseAiMessage: ChatMessage = {
    id: "ai-1",
    sender: "AI",
    message: "",
    isVisible: true,
    timestamp: null,
  };

  beforeEach(() => {
    renderMarkdownMock.mockReset();
    renderMarkdownMock.mockResolvedValue(undefined);
  });

  beforeAll(() => {
    (window as unknown as Record<string, unknown>).activeDocument = window.document;
  });

  /**
   * Asserts that no line in the rendered markdown matches:
   *   <4+ spaces><any content></div>  or  <4+ spaces><any content></details>
   * Such a pattern means the closing tag is inside a code block and will be
   * escaped by the markdown renderer.
   */
  function assertNoClosingTagOnIndentedLine(capturedMarkdown: string[]) {
    for (const md of capturedMarkdown) {
      for (const line of md.split("\n")) {
        if (/^ {4}/.test(line)) {
          expect(line).not.toContain("</div>");
          expect(line).not.toContain("</details>");
        }
      }
    }
  }

  it("does not place </div> on a 4-space-indented line (non-streaming, think block)", async () => {
    const thinkContent =
      "Planning my response:\n    *   Be helpful and direct.\n    *   Answer clearly.";
    const messageText = `<think>${thinkContent}</think>Here is my answer.`;

    const capturedMarkdown: string[] = [];
    renderMarkdownMock.mockImplementation(async (_app: unknown, md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.textContent = "rendered";
    });

    render(
      <TooltipProvider>
        <ChatSingleMessage
          message={{ ...baseAiMessage, message: messageText }}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    assertNoClosingTagOnIndentedLine(capturedMarkdown);
  });

  it("does not place </div> on a 4-space-indented line (streaming, complete think block)", async () => {
    const thinkContent = "Thinking:\n    1.  First step.\n    2.  Second step.";
    const messageText = `<think>${thinkContent}</think>Response text.`;

    const capturedMarkdown: string[] = [];
    renderMarkdownMock.mockImplementation(async (_app: unknown, md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.textContent = "rendered";
    });

    render(
      <TooltipProvider>
        <ChatSingleMessage
          message={{ ...baseAiMessage, message: messageText }}
          app={createAppStub()}
          isStreaming={true}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    assertNoClosingTagOnIndentedLine(capturedMarkdown);
  });

  it("does not place </div> on a 4-space-indented line (streaming, unclosed think block)", async () => {
    // Simulates mid-stream: the </think> closing tag has not arrived yet.
    const messageText = "<think>Thinking:\n    *   Still streaming.";

    const capturedMarkdown: string[] = [];
    renderMarkdownMock.mockImplementation(async (_app: unknown, md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.textContent = "rendered";
    });

    render(
      <TooltipProvider>
        <ChatSingleMessage
          message={{ ...baseAiMessage, message: messageText }}
          app={createAppStub()}
          isStreaming={true}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    assertNoClosingTagOnIndentedLine(capturedMarkdown);
  });
});

describe("normalizeFootnoteRendering", () => {
  beforeEach(() => {
    renderMarkdownMock.mockReset();
    renderMarkdownMock.mockResolvedValue(undefined);
  });

  it("removes separator and backref while preserving non-footnote elements", () => {
    const container = window.document.createElement("div");
    container.append(
      ...new DOMParser().parseFromString(
        `
      <div>
        <p>Body <sup><a href="#fn-1">1-1</a></sup></p>
        <hr class="content-separator" />
        <div class="footnotes">
          <hr class="footnotes-sep" />
          <ol>
            <li id="fn-1">
              Entry <a class="footnote-backref" href="#ref">↩</a>
            </li>
          </ol>
        </div>
      </div>
    `,
        "text/html"
      ).body.children
    );

    normalizeFootnoteRendering(container);

    expect(container.querySelector(".footnotes hr")).toBeNull();
    expect(container.querySelector(".footnote-backref")).toBeNull();
    expect(container.querySelector(".content-separator")).not.toBeNull();
    expect(container.querySelector('a[href="#fn-1"]')?.textContent).toBe("1");
  });

  it("leaves non-numeric footnote references untouched", () => {
    const container = window.document.createElement("div");
    container.append(
      ...new DOMParser().parseFromString(
        `
      <p>Body <sup><a href="#fn-note">Note-A</a></sup></p>
      <a class="footnote-backref" href="#ref">↩</a>
    `,
        "text/html"
      ).body.children
    );

    normalizeFootnoteRendering(container);

    expect(container.querySelector('a[href="#fn-note"]')?.textContent).toBe("Note-A");
    expect(container.querySelector(".footnote-backref")).toBeNull();
  });
});

describe("ChatSingleMessage", () => {
  const baseMessage: ChatMessage = {
    id: "message-1",
    message: "Test message",
    sender: "assistant",
    timestamp: { epoch: Date.now(), display: "now", fileName: "now" },
    isVisible: true,
  };

  const createAppStub = (): App =>
    ({
      workspace: {
        getActiveFile: jest.fn(() => null),
        getMostRecentLeaf: jest.fn(() => null),
        getLeaf: jest.fn(() => null),
      },
      metadataCache: {
        getFirstLinkpathDest: jest.fn(() => null),
      },
    }) as unknown as App;

  beforeEach(() => {
    renderMarkdownMock.mockReset();
    renderMarkdownMock.mockResolvedValue(undefined);
  });

  beforeAll(() => {
    (window as unknown as Record<string, unknown>).activeDocument = window.document;
  });

  it("renders a truncated response as an ordinary message, with no card offering a setting to raise (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={{
            ...baseMessage,
            message: "The coastline is famously hard to",
            responseMetadata: { wasTruncated: true, tokenUsage: { outputTokens: 20000 } },
          }}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    expect(container.querySelector(".message-segment")).toBeTruthy();
    expect(container.textContent).not.toContain("Response Truncated");
    expect(container.textContent).not.toContain("Open Model Settings");
    expect(container.textContent).not.toContain("Token Limit");
  });

  it("normalizes rendered footnotes for assistant messages", async () => {
    renderMarkdownMock.mockImplementation(
      async (_app: unknown, _markdown: string, el: HTMLElement) => {
        el.append(
          ...new DOMParser().parseFromString(
            `
        <p>Example <sup><a href="#fn-2">2-1</a></sup></p>
        <hr class="content-hr" />
        <div class="footnotes">
          <hr class="footnotes-sep" />
          <ol>
            <li id="fn-2">
              Source <a class="footnote-backref" href="#back">↩</a>
            </li>
          </ol>
        </div>
      `,
            "text/html"
          ).body.children
        );
      }
    );

    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={baseMessage}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    const messageSegment = container.querySelector(".message-segment");
    expect(messageSegment).toBeTruthy();
    expect(messageSegment?.querySelector(".footnotes hr")).toBeNull();
    expect(messageSegment?.querySelector(".footnote-backref")).toBeNull();
    expect(messageSegment?.querySelector(".content-hr")).not.toBeNull();
    expect(messageSegment?.querySelector('a[href="#fn-2"]')?.textContent).toBe("2");
  });

  it("turns an inline citation marker into a link that keeps the source anchor's Obsidian metadata", async () => {
    renderMarkdownMock.mockImplementation(
      async (_app: unknown, _markdown: string, el: HTMLElement) => {
        el.append(
          ...new DOMParser().parseFromString(
            `
        <p>A claim <span class="copilot-citation-ref">[1]</span></p>
        <div class="copilot-sources">
          <div class="copilot-sources__item">
            <span class="copilot-sources__index">[1]</span>
            <span class="copilot-sources__text">
              <a class="internal-link" data-href="Some Note">Some Note</a>
            </span>
          </div>
        </div>
      `,
            "text/html"
          ).body.children
        );
      }
    );

    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={baseMessage}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(container.querySelector(".copilot-citation-group")).not.toBeNull());

    const group = container.querySelector(".copilot-citation-group");
    expect(group?.textContent).toBe("[1]");
    const link = group?.querySelector("a.copilot-citation-link");
    expect(link?.textContent).toBe("1");
    expect(link?.getAttribute("aria-label")).toBe("Source 1");
    expect(link?.getAttribute("data-href")).toBe("Some Note");
    expect(container.querySelector(".copilot-citation-ref")).toBeNull();
  });

  it("marks rendered text segments with markdown-rendered for native reading-view styling", async () => {
    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={baseMessage}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    const messageSegment = container.querySelector(".message-segment");
    expect(messageSegment).toBeTruthy();
    expect(messageSegment?.classList.contains("markdown-rendered")).toBe(true);
  });

  it("shows supplied Agent Mode metadata instead of the timestamp in the response footer", async () => {
    const timestamp = "2026/08/07 20:31:10";
    const { rerender } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={{ ...baseMessage, timestamp: { epoch: 1, display: timestamp, fileName: "now" } }}
          app={createAppStub()}
          isStreaming={false}
          footerStart={<span>Worked for 24s</span>}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    const duration = screen.getByText("Worked for 24s");
    const footer = duration.closest(".tw-justify-between");
    expect(footer?.classList.contains("tw-items-center")).toBe(true);
    expect(footer?.contains(screen.getByTitle("Copy"))).toBe(true);
    expect(screen.queryByText(timestamp)).toBeNull();

    rerender(
      <TooltipProvider>
        <ChatSingleMessage
          message={{ ...baseMessage, timestamp: { epoch: 1, display: timestamp, fileName: "now" } }}
          app={createAppStub()}
          isStreaming={false}
        />
      </TooltipProvider>
    );
    expect(screen.getByText(timestamp)).toBeTruthy();
  });
});
