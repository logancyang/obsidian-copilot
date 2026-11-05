import { logWarn } from "@/logger";
import type { KeyedSelection, SelectionReport } from "@/selection/selectionStore";
import * as actions from "@/services/webViewerService/webViewerServiceActions";
import type {
  WebViewerLeaf,
  WebviewElement,
} from "@/services/webViewerService/webViewerServiceTypes";
import type { WebSelectedTextContext } from "@/types/message";
import { v4 as uuidv4 } from "uuid";

// Selecting inside a web page never reaches Obsidian's document, so the page itself waits for its selection to
// change and settle, and answers the one pending call; every caller on the same page shares that wait.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/844
const WAIT_FOR_SELECTION_CHANGE = `(() => {
  if (!window.__copilotSelectionChange) {
    window.__copilotSelectionChange = new Promise((resolve) => {
      let settle;
      const onChange = () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
          document.removeEventListener("selectionchange", onChange);
          window.__copilotSelectionChange = undefined;
          resolve(true);
        }, 150);
      };
      document.addEventListener("selectionchange", onChange);
    });
  }
  return window.__copilotSelectionChange;
})()`;

export function webSelectionReport(context: WebSelectedTextContext): KeyedSelection {
  return { location: context.url, key: `web:${context.url}:${context.content}`, context };
}

export async function readWebSelection(leaf: WebViewerLeaf): Promise<SelectionReport> {
  const pageInfo = actions.getPageInfo(leaf);
  const content = await actions.getSelectedMarkdown(leaf);
  // A page read with nothing selected was deselected there, which clears its excerpt.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/844
  if (!content.trim()) return { location: pageInfo.url, context: null };

  return webSelectionReport({
    id: uuidv4(),
    content,
    sourceType: "web",
    title: pageInfo.title || "Untitled",
    url: pageInfo.url,
    faviconUrl: pageInfo.faviconUrl || undefined,
  });
}

export class WebSelectionWatcher {
  private readonly latestWatch = new WeakMap<WebviewElement, object>();
  private stopped = false;

  constructor(private readonly report: (report: SelectionReport) => void) {}

  watch(leaf: WebViewerLeaf): void {
    const webview = leaf.view.webview;
    const watch = {};
    this.latestWatch.set(webview, watch);

    const waitForChange = (): void => {
      let change: Promise<unknown>;
      try {
        change = webview.executeJavaScript(WAIT_FOR_SELECTION_CHANGE);
      } catch {
        // A web view throws until its page is ready; it is watched again once that page finishes loading.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/844
        return;
      }
      change
        .then(() => {
          // A newer watch of the same web view already waits on the page.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/844
          if (this.stopped || this.latestWatch.get(webview) !== watch) return;
          waitForChange();
          return readWebSelection(leaf).then(this.report);
        })
        .catch((error) => logWarn("Could not read the selection of a web tab", error));
    };
    waitForChange();
  }

  stop(): void {
    this.stopped = true;
  }
}
