import React from "react";
import { render, waitFor } from "@testing-library/react";
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
  const renderMarkdown = jest.fn().mockResolvedValue(undefined);
  return {
    MarkdownRenderer: {
      renderMarkdown,
    },
    Component: class {
      load() {}
      unload() {}
    },
    MarkdownView: class {},
    TFile: class {},
    App: class {},
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
    __renderMarkdownMock: renderMarkdown,
  };
});

const { __renderMarkdownMock: renderMarkdownMock } = jest.requireMock("obsidian") as {
  __renderMarkdownMock: jest.Mock;
};

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
    (globalThis as any).activeDocument = document;
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
    renderMarkdownMock.mockImplementation(async (md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.innerHTML = "<p>rendered</p>";
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
    renderMarkdownMock.mockImplementation(async (md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.innerHTML = "<p>rendered</p>";
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
    renderMarkdownMock.mockImplementation(async (md: string, el: HTMLElement) => {
      capturedMarkdown.push(md);
      el.innerHTML = "<p>rendered</p>";
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
    const container = document.createElement("div");
    container.innerHTML = `
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
    `;

    normalizeFootnoteRendering(container);

    expect(container.querySelector(".footnotes hr")).toBeNull();
    expect(container.querySelector(".footnote-backref")).toBeNull();
    expect(container.querySelector(".content-separator")).not.toBeNull();
    expect(container.querySelector('a[href="#fn-1"]')?.textContent).toBe("1");
  });

  it("leaves non-numeric footnote references untouched", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <p>Body <sup><a href="#fn-note">Note-A</a></sup></p>
      <a class="footnote-backref" href="#ref">↩</a>
    `;

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
    (globalThis as any).activeDocument = document;
  });

  it("normalizes rendered footnotes for assistant messages", async () => {
    renderMarkdownMock.mockImplementation(async (_markdown: string, el: HTMLElement) => {
      el.innerHTML = `
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
      `;
    });

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
});
