import {
  readWebSelection,
  webSelectionReport,
} from "@/services/webViewerService/webViewerServiceSelection";
import type { WebViewerLeaf } from "@/services/webViewerService/webViewerServiceTypes";

function createWebTab(selectedHtml: string): WebViewerLeaf {
  return {
    view: {
      url: "https://example.com/",
      title: "Example Domain",
      faviconUrl: "https://example.com/favicon.ico",
      webview: {
        getURL: () => "https://example.com/",
        executeJavaScript: async () => selectedHtml,
      },
    },
  } as unknown as WebViewerLeaf;
}

describe("webViewerServiceSelection", () => {
  describe("webSelectionReport()", () => {
    it("reports a web excerpt under its page, keyed by the page and the excerpt", () => {
      const context = {
        id: "web-1",
        content: "Quote",
        sourceType: "web" as const,
        title: "Page",
        url: "https://example.com/",
      };

      expect(webSelectionReport(context)).toEqual({
        location: "https://example.com/",
        key: "web:https://example.com/:Quote",
        context,
      });
    });
  });

  describe("readWebSelection()", () => {
    it("reports the text selected in a web tab as a Markdown excerpt of its page", async () => {
      const report = await readWebSelection(createWebTab("<strong>Quote</strong>"));

      expect(report).toEqual({
        location: "https://example.com/",
        key: "web:https://example.com/:**Quote**",
        context: {
          id: expect.any(String) as unknown,
          content: "**Quote**",
          sourceType: "web",
          title: "Example Domain",
          url: "https://example.com/",
          faviconUrl: "https://example.com/favicon.ico",
        },
      });
    });

    it("reports a cleared selection for the page when nothing is selected in it https://github.com/Brevilabs/obsidian-copilot-private/issues/844", async () => {
      const report = await readWebSelection(createWebTab(""));

      expect(report).toEqual({ location: "https://example.com/", context: null });
    });
  });
});
