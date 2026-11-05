import type { SelectionReport } from "@/selection/selectionStore";
import {
  readWebSelection,
  WebSelectionWatcher,
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

const ISSUE_844 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/844";

function createLivePage() {
  let selectedHtml = "";
  let resolveChange: () => void = () => {};
  let change = new Promise<void>((resolve) => (resolveChange = resolve));
  let ready = true;
  const waits: Promise<void>[] = [];
  const executeJavaScript = jest.fn((code: string) => {
    if (!ready) throw new Error("The WebView must be attached to the DOM");
    if (!code.includes("__copilotSelectionChange")) return Promise.resolve(selectedHtml);
    waits.push(change);
    return change;
  });
  const leaf = {
    view: {
      url: "https://example.com/",
      title: "Example Domain",
      faviconUrl: "",
      webview: { getURL: () => "https://example.com/", executeJavaScript },
    },
  } as unknown as WebViewerLeaf;

  return {
    leaf,
    waits,
    setReady: (value: boolean) => (ready = value),
    selectInPage: (html: string) => {
      selectedHtml = html;
      const settled = change;
      resolveChange();
      change = new Promise<void>((resolve) => (resolveChange = resolve));
      return settled;
    },
  };
}

function nextReport() {
  let resolveReport: (report: SelectionReport) => void = () => {};
  const reported = new Promise<SelectionReport>((resolve) => (resolveReport = resolve));
  return { report: jest.fn((report: SelectionReport) => resolveReport(report)), reported };
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

    it(`reports a cleared selection for the page when nothing is selected in it ${ISSUE_844}`, async () => {
      const report = await readWebSelection(createWebTab(""));

      expect(report).toEqual({ location: "https://example.com/", context: null });
    });
  });

  describe("WebSelectionWatcher", () => {
    describe("watch()", () => {
      it("reports the page's selection each time it changes, and keeps waiting for the next change", async () => {
        const page = createLivePage();
        const { report, reported } = nextReport();
        new WebSelectionWatcher(report).watch(page.leaf);

        void page.selectInPage("<em>Quote</em>");

        expect(await reported).toMatchObject({ context: { content: "*Quote*" } });
        expect(page.waits).toHaveLength(2);
      });

      it("reports a cleared selection when the page is deselected", async () => {
        const page = createLivePage();
        const { report, reported } = nextReport();
        new WebSelectionWatcher(report).watch(page.leaf);

        void page.selectInPage("");

        expect(await reported).toEqual({ location: "https://example.com/", context: null });
      });

      it(`does nothing for a web view whose page is not ready yet, and works when watched again after it loads ${ISSUE_844}`, async () => {
        const page = createLivePage();
        const { report, reported } = nextReport();
        const watcher = new WebSelectionWatcher(report);
        page.setReady(false);

        expect(() => watcher.watch(page.leaf)).not.toThrow();
        page.setReady(true);
        watcher.watch(page.leaf);
        void page.selectInPage("Quote");

        expect(await reported).toMatchObject({ context: { content: "Quote" } });
      });

      it(`reports a change once when the same page was watched twice ${ISSUE_844}`, async () => {
        const page = createLivePage();
        const { report, reported } = nextReport();
        const watcher = new WebSelectionWatcher(report);
        watcher.watch(page.leaf);
        watcher.watch(page.leaf);

        void page.selectInPage("Quote");
        await reported;

        expect(report).toHaveBeenCalledTimes(1);
        expect(page.waits).toHaveLength(3);
      });
    });

    describe("stop()", () => {
      it("stops reporting and waiting for changes", async () => {
        const page = createLivePage();
        const report = jest.fn();
        const watcher = new WebSelectionWatcher(report);
        watcher.watch(page.leaf);

        watcher.stop();
        await page.selectInPage("Quote");

        expect(report).not.toHaveBeenCalled();
        expect(page.waits).toHaveLength(1);
      });
    });
  });
});
