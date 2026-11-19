import React from "react";
import { AppContext } from "@/context";
import { fireEvent, render as renderComponent, screen, waitFor } from "@testing-library/react";
import ChatSingleMessage, {
  normalizeFootnoteRendering,
} from "@/components/chat-components/ChatSingleMessage";
import { ChatMessage } from "@/types/message";
import type { App } from "obsidian";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatMessageClock } from "@/lib/messageTime";

const mockCopy = jest.fn();
jest.mock("@/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: jest.fn(() => ({ isCopied: false, copy: mockCopy })),
}));
jest.mock("@/components/chat-components/InlineMessageEditor", () => ({
  InlineMessageEditor: ({ initialValue }: { initialValue: string }) => (
    <textarea aria-label="Edit message" defaultValue={initialValue} />
  ),
}));

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
      open() {}
      close() {}
    },
    __renderMock: render,
  };
});

const { __renderMock: renderMarkdownMock } = jest.requireMock<{
  __renderMock: jest.Mock;
}>("obsidian");

const testApp = {
  workspace: { getActiveFile: () => null },
  metadataCache: { getFirstLinkpathDest: () => null },
} as unknown as App;

function render(ui: React.ReactElement) {
  return renderComponent(<AppContext.Provider value={testApp}>{ui}</AppContext.Provider>);
}

function stubContentDimensions(scrollHeightPx: number, clientHeightPx: number): () => void {
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeightPx,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeightPx,
  });
  return () => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  };
}

describe("ChatSingleMessage", () => {
  beforeAll(() => {
    (window as unknown as Record<string, unknown>).activeDocument = window.document;
  });

  beforeEach(() => {
    renderMarkdownMock.mockReset();
    renderMarkdownMock.mockImplementation(async (_app: unknown, text: string, el: HTMLElement) => {
      el.textContent = text;
    });
  });

  describe("ChatSingleMessage()", () => {
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

    it.each([false, true])(
      "renders user Markdown through Obsidian with rich content = %s",
      async (richContent) => {
        const markdown = "**Review** this `diagram`\n\n- First finding\n- Second finding";
        renderMarkdownMock.mockImplementation(
          async (_app: unknown, text: string, el: HTMLElement) => {
            expect(text).toBe(markdown);
            const strong = document.createElement("strong");
            strong.textContent = "Review";
            el.append(strong);
          }
        );
        const { container } = render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{
                ...baseMessage,
                sender: "user",
                message: markdown,
                content: richContent
                  ? [
                      { type: "text", text: markdown },
                      { type: "image_url", image_url: { url: "data:image/png;base64,cGl4ZWw=" } },
                    ]
                  : undefined,
              }}
              app={testApp}
              isStreaming={false}
            />
          </TooltipProvider>
        );
        await waitFor(() =>
          expect(container.querySelector(".markdown-rendered strong")?.textContent).toBe("Review")
        );
        expect(renderMarkdownMock).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll("img")).toHaveLength(richContent ? 1 : 0);
        if (richContent)
          expect(screen.getByAltText("User uploaded image").getAttribute("src")).toBe(
            "data:image/png;base64,cGl4ZWw="
          );
      }
    );

    it("renders a reloaded user image embed through Obsidian instead of showing its Markdown source", async () => {
      const markdown = "Describe this image\n\n![[organized/diagram.png]]";
      renderMarkdownMock.mockImplementation(
        async (_app: unknown, text: string, el: HTMLElement) => {
          expect(text).toBe(markdown);
          const image = document.createElement("img");
          image.alt = "Saved diagram";
          image.src = "app://vault/organized/diagram.png";
          el.append(image);
        }
      );
      const { container } = render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, sender: "user", message: markdown }}
            app={testApp}
            isStreaming={false}
          />
        </TooltipProvider>
      );
      await waitFor(() =>
        expect(screen.getByAltText("Saved diagram").getAttribute("src")).toBe(
          "app://vault/organized/diagram.png"
        )
      );
      expect(container.textContent).not.toContain("![[organized/diagram.png]]");
      expect(container.querySelectorAll("img")).toHaveLength(1);
    });

    it("keeps raw Markdown for Copy and Edit while rendering the user message", async () => {
      const markdown = "**Review** the `diagram`\n\n![[organized/diagram.png]]";
      render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, sender: "user", message: markdown }}
            app={testApp}
            isStreaming={false}
            onEdit={() => undefined}
          />
        </TooltipProvider>
      );
      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());
      fireEvent.click(screen.getByTitle("Copy"));
      expect(mockCopy).toHaveBeenLastCalledWith(markdown);
      fireEvent.click(screen.getByTitle("Edit"));
      expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Edit message" }).value).toBe(
        markdown
      );
    });

    it.each(["", "chat/Conversation.md"])(
      "resolves user Markdown from conversation source %s instead of the active editor https://github.com/Brevilabs/obsidian-copilot-private/issues/539",
      async (sourcePath) => {
        const app = {
          ...testApp,
          workspace: { getActiveFile: () => ({ path: "other/Context.md" }) },
        } as unknown as App;
        render(
          <TooltipProvider>
            <ChatSingleMessage
              {...{ sourcePath }}
              message={{ ...baseMessage, sender: "user", message: "[[MarkdownTarget]]" }}
              app={app}
              isStreaming={false}
            />
          </TooltipProvider>
        );
        await waitFor(() =>
          expect(renderMarkdownMock).toHaveBeenCalledWith(
            testApp,
            "[[MarkdownTarget]]",
            expect.any(HTMLElement),
            `${sourcePath}?no-dataview`,
            expect.anything()
          )
        );
      }
    );

    it("passes user reasoning syntax to Markdown without assistant preprocessing", async () => {
      const markdown = "Explain this syntax: <think>draft</think>";
      render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, sender: "user", message: markdown }}
            app={testApp}
            isStreaming={false}
          />
        </TooltipProvider>
      );
      await waitFor(() =>
        expect(renderMarkdownMock).toHaveBeenCalledWith(
          testApp,
          markdown,
          expect.any(HTMLElement),
          "?no-dataview",
          expect.anything()
        )
      );
    });

    describe("sent context selections", () => {
      it.each(["note", "web"] as const)(
        "shows one full-excerpt tooltip for a sent %s selection https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
        async (sourceType) => {
          const source =
            sourceType === "note"
              ? {
                  sourceType,
                  notePath: "Research.md",
                  noteTitle: "Research",
                  startLine: 2,
                  endLine: 2,
                }
              : { sourceType, url: "https://example.com/research", title: "Research" };
          render(
            <TooltipProvider delayDuration={0}>
              <ChatSingleMessage
                message={{
                  ...baseMessage,
                  context: {
                    notes: [],
                    urls: [],
                    selectedTextContexts: [
                      { ...source, id: "excerpt", content: "Interview findings" },
                    ],
                  },
                }}
                app={createAppStub()}
                isStreaming={false}
                onDelete={() => {}}
              />
            </TooltipProvider>
          );
          fireEvent.focus(screen.getByText("Interview findings"));
          await waitFor(() => expect(screen.getAllByRole("tooltip")).toHaveLength(1));
          expect(screen.getByRole("tooltip").textContent).toContain("Interview findings");
          expect(screen.getByRole("tooltip").textContent).toContain(
            sourceType === "note" ? "Research.md" : "https://example.com/research"
          );
        }
      );
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

    it("shows supplied Agent Mode metadata instead of the time in the response footer", async () => {
      const sentAt = new Date(2026, 7, 7, 20, 31, 10).getTime();
      const timestamp = { epoch: sentAt, display: "2026/08/07 20:31:10", fileName: "now" };
      const { rerender } = render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, timestamp }}
            app={createAppStub()}
            isStreaming={false}
            footerStart={<span>Worked for 24s</span>}
          />
        </TooltipProvider>
      );

      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

      const duration = screen.getByText("Worked for 24s");
      const footer = duration.closest(".tw-justify-between");
      expect(footer?.contains(screen.getByTitle("Copy"))).toBe(true);
      expect(screen.queryByText(formatMessageClock(sentAt))).toBeNull();

      rerender(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, timestamp }}
            app={createAppStub()}
            isStreaming={false}
          />
        </TooltipProvider>
      );
      expect(screen.getByText(formatMessageClock(sentAt))).toBeTruthy();
      expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 floats a user message's time and buttons in a bar at the bubble's lower right that takes no space and shows only while the message is pointed at or focused", () => {
      const sentAt = new Date(2026, 10, 18, 14, 2, 11).getTime();
      render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{
              ...baseMessage,
              sender: "user",
              message: "Draft the recap",
              timestamp: { epoch: sentAt, display: "2026/11/18 14:02:11", fileName: "" },
            }}
            app={createAppStub()}
            isStreaming={false}
          />
        </TooltipProvider>
      );

      const bubble = screen.getByText("Draft the recap").closest(".tw-border-solid");
      const time = screen.getByText(formatMessageClock(sentAt));
      const bar = time.closest(".tw-absolute");
      expect(bubble?.contains(time)).toBe(false);
      expect(bar?.contains(screen.getByTitle("Copy"))).toBe(true);
      expect(bar?.className).toContain("tw-right-4");
      expect(bar?.className).toContain("tw-bottom-0");
      expect(bar?.className).toContain("tw-opacity-0");
      expect(bar?.className).toContain("group-hover/message:tw-opacity-100");
      expect(bar?.className).toContain("group-focus-within/message:tw-opacity-100");
      expect(bar?.parentElement?.className).toContain("tw-group/message");
      expect(bar?.parentElement?.className).toContain("tw-relative");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 keeps a phone message's time and one Message actions button in view under the bubble, since a phone has no pointer to hover with", () => {
      const { Platform } = jest.requireMock<{ Platform: { isMobile: boolean } }>("obsidian");
      Platform.isMobile = true;
      try {
        const sentAt = new Date(2026, 10, 18, 14, 2, 11).getTime();
        render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{
                ...baseMessage,
                sender: "user",
                message: "Which one is shortest?",
                timestamp: { epoch: sentAt, display: "2026/11/18 14:02:11", fileName: "" },
              }}
              app={createAppStub()}
              isStreaming={false}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
          </TooltipProvider>
        );

        const time = screen.getByText(formatMessageClock(sentAt));
        expect(time.className).not.toContain("tw-opacity-0");
        expect(time.closest(".tw-absolute")).toBeNull();
        expect(
          screen.getByText("Which one is shortest?").closest(".tw-border-solid")?.contains(time)
        ).toBe(false);
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
          "Message actions",
        ]);
      } finally {
        Platform.isMobile = false;
      }
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 copies and inserts the whole response's text from the reply that ends the response", async () => {
      const insert = jest.spyOn(
        jest.requireActual<typeof import("@/utils")>("@/utils"),
        "insertAtCursor"
      );
      insert.mockResolvedValue(undefined);
      const app = createAppStub();
      render(
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...baseMessage, message: "The year is fixed." }}
            app={app}
            isStreaming={false}
            responseText={"I asked Maya.\n\nThe year is fixed."}
          />
        </TooltipProvider>
      );
      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

      fireEvent.click(screen.getByTitle("Copy"));
      fireEvent.click(screen.getByTitle("Insert / Replace at cursor"));

      expect(mockCopy).toHaveBeenLastCalledWith("I asked Maya.\n\nThe year is fixed.");
      expect(insert).toHaveBeenCalledWith(app, "I asked Maya.\n\nThe year is fixed.");
      insert.mockRestore();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 keeps a reply's row outside the box that clips its content, so the phone's larger menu button is not cut off", async () => {
      render(
        <TooltipProvider>
          <ChatSingleMessage message={baseMessage} app={createAppStub()} isStreaming={false} />
        </TooltipProvider>
      );
      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

      expect(screen.getByTitle("Copy").closest(".tw-overflow-hidden")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 renders no row under a reply inside a response, whose row sits at the response's end", async () => {
      render(
        <TooltipProvider>
          <ChatSingleMessage
            message={baseMessage}
            app={createAppStub()}
            isStreaming={false}
            footerStart={<span>Worked for 24s</span>}
            hideFooter
          />
        </TooltipProvider>
      );
      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

      expect(screen.queryByTitle("Copy")).toBeNull();
      expect(screen.queryByText("Worked for 24s")).toBeNull();
    });

    it("collapses an oversized user message behind a Show more control (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      const restoreContentHeight = stubContentDimensions(2000, 240);

      try {
        render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{ ...baseMessage, sender: "user", message: "A very long pasted prompt" }}
              app={createAppStub()}
              isStreaming={false}
            />
          </TooltipProvider>
        );

        expect(screen.getByTestId("clamped-content").classList.contains("tw-max-h-[12lh]")).toBe(
          true
        );
        expect(screen.getByRole("button", { name: /show more/i })).toBeTruthy();
        expect(screen.getByText("A very long pasted prompt")).toBeTruthy();
      } finally {
        restoreContentHeight();
      }
    });

    it("leaves a short user message without an expand control (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      const restoreContentHeight = stubContentDimensions(40, 40);

      try {
        render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{ ...baseMessage, sender: "user", message: "Hi" }}
              app={createAppStub()}
              isStreaming={false}
            />
          </TooltipProvider>
        );

        expect(screen.getByTestId("clamped-content").getAttribute("style")).toBeNull();
        expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
      } finally {
        restoreContentHeight();
      }
    });

    it("never collapses an assistant message, whose trail owns its own folding (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", async () => {
      const restoreContentHeight = stubContentDimensions(2000, 240);

      try {
        render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{ ...baseMessage, message: "A very long answer" }}
              app={createAppStub()}
              isStreaming={false}
            />
          </TooltipProvider>
        );

        await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

        expect(screen.queryByTestId("clamped-content")).toBeNull();
        expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
      } finally {
        restoreContentHeight();
      }
    });

    it.each([
      {
        label: "a complete think block after the response finishes",
        isStreaming: false,
        message:
          "<think>Planning my response:\n    *   Be helpful and direct.\n    *   Answer clearly.</think>Here is my answer.",
      },
      {
        label: "a complete think block while streaming",
        isStreaming: true,
        message:
          "<think>Thinking:\n    1.  First step.\n    2.  Second step.</think>Response text.",
      },
      {
        label: "an unclosed think block while streaming",
        isStreaming: true,
        message: "<think>Thinking:\n    *   Still streaming.",
      },
    ])(
      "keeps closing tags off 4-space-indented lines of $label",
      async ({ isStreaming, message }) => {
        const capturedMarkdown: string[] = [];
        renderMarkdownMock.mockImplementation(
          async (_app: unknown, md: string, el: HTMLElement) => {
            capturedMarkdown.push(md);
            el.textContent = "rendered";
          }
        );

        render(
          <TooltipProvider>
            <ChatSingleMessage
              message={{ ...baseMessage, message }}
              app={createAppStub()}
              isStreaming={isStreaming}
              onDelete={() => {}}
            />
          </TooltipProvider>
        );

        await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

        const indentedLines = capturedMarkdown
          .flatMap((md) => md.split("\n"))
          .filter((line) => /^ {4}/.test(line));
        expect(indentedLines.length).toBeGreaterThan(0);
        for (const line of indentedLines) {
          expect(line).not.toContain("</div>");
          expect(line).not.toContain("</details>");
        }
      }
    );
  });

  describe("normalizeFootnoteRendering()", () => {
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
});
