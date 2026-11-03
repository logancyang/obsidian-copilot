import { ACTIVE_WEB_TAB_CONTEXT_TAG, WEB_TAB_CONTEXT_TAG } from "@/constants";
import { ContextProcessor } from "@/contextProcessor";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { WebViewerLeaf } from "@/services/webViewerService/webViewerServiceTypes";

jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));

const mockGetWebViewerService = getWebViewerService as jest.Mock;

interface FakePage {
  url: string;
  title: string;
  markdown: string;
}

function createLeaf(page: FakePage): WebViewerLeaf {
  return {
    view: {
      url: page.url,
      title: page.title,
      getReaderModeContent: () => ({ md: page.markdown }),
    },
  } as unknown as WebViewerLeaf;
}

interface FocusedLeaves {
  active: WebViewerLeaf | null;
  lastActive: WebViewerLeaf | null;
}

function mockWebViewer(leaves: WebViewerLeaf[], focused: FocusedLeaves): void {
  mockGetWebViewerService.mockReturnValue({
    getAvailability: () => ({ supported: true, available: true }),
    getYouTubeVideoId: () => null,
    findLeafByUrl: (url: string) =>
      leaves.find((leaf) => (leaf.view as { url: string }).url === url) ?? null,
    getActiveLeaf: () => focused.active,
    getLastActiveLeaf: () => focused.lastActive,
    getPageInfo: (leaf: WebViewerLeaf) => ({
      url: (leaf.view as { url: string }).url,
      title: (leaf.view as { title: string }).title,
      faviconUrl: "",
      mode: "webview",
    }),
    getReaderModeMarkdown: async (leaf: WebViewerLeaf) =>
      (leaf.view as { getReaderModeContent: () => { md: string } }).getReaderModeContent().md,
  });
}

const sentItem: FakePage = {
  url: "https://mail.example.com/mail/sentitems/id/second",
  title: "Sent Items",
  markdown: "Hello Frans, here is the quarterly plan.",
};

describe("contextProcessor", () => {
  describe("ContextProcessor", () => {
    let processor: ContextProcessor;

    beforeEach(() => {
      processor = ContextProcessor.getInstance(window.app);
      mockGetWebViewerService.mockReset();
    });

    describe("processContextWebTabs()", () => {
      it("includes the page content of an attached tab that is open at its URL", async () => {
        const leaf = createLeaf(sentItem);
        mockWebViewer([leaf], { active: null, lastActive: null });

        const result = await processor.processContextWebTabs([
          { url: sentItem.url, title: sentItem.title },
        ]);

        expect(result).toContain(`<${WEB_TAB_CONTEXT_TAG}>`);
        expect(result).toContain("<content>\nHello Frans, here is the quarterly plan.\n</content>");
        expect(result).not.toContain("<error>");
      });

      it.each([
        ["still the most recent main-area tab", { active: true, lastActive: false }],
        ["the last web tab the user focused", { active: false, lastActive: true }],
      ])(
        "reads the active tab where it is now, as %s, when a single-page app changed its URL in place, instead of reporting it closed (https://github.com/logancyang/obsidian-copilot/issues/3693)",
        async (_where, focus) => {
          const leaf = createLeaf(sentItem);
          mockWebViewer([leaf], {
            active: focus.active ? leaf : null,
            lastActive: focus.lastActive ? leaf : null,
          });

          const result = await processor.processContextWebTabs([
            {
              url: "https://mail.example.com/mail/sentitems/id/first",
              title: "Sent Items",
              isActive: true,
            },
          ]);

          expect(result).toContain(`<${ACTIVE_WEB_TAB_CONTEXT_TAG}>`);
          expect(result).toContain(`<url>${sentItem.url}</url>`);
          expect(result).toContain(
            "<content>\nHello Frans, here is the quarterly plan.\n</content>"
          );
          expect(result).not.toContain("<error>");
        }
      );

      it("reports a non-active tab as closed when no open tab has its URL", async () => {
        const leaf = createLeaf(sentItem);
        mockWebViewer([leaf], { active: leaf, lastActive: leaf });

        const result = await processor.processContextWebTabs([
          { url: "https://example.com/closed", title: "Closed page" },
        ]);

        expect(result).toContain("<error>Web tab not found or closed</error>");
      });
    });
  });
});
