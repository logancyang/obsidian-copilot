import type { KeyedSelection, SelectionReport } from "@/selection/selectionStore";
import * as actions from "@/services/webViewerService/webViewerServiceActions";
import type { WebViewerLeaf } from "@/services/webViewerService/webViewerServiceTypes";
import type { WebSelectedTextContext } from "@/types/message";
import { v4 as uuidv4 } from "uuid";

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
