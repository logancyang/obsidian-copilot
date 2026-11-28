import type { App } from "obsidian";

import { WebViewerStateManager } from "@/services/webViewerService/webViewerServiceState";
import {
  WEB_VIEWER_VIEW_TYPE,
  type WebViewerLeaf,
} from "@/services/webViewerService/webViewerServiceTypes";

const inbox = {
  view: { url: "https://mail.example.com/inbox", getViewType: () => WEB_VIEWER_VIEW_TYPE },
} as unknown as WebViewerLeaf;

function createManager(openLeaves: WebViewerLeaf[]) {
  const workspace = { openLeaves };
  const manager = new WebViewerStateManager({
    app: { workspace: { on: () => ({}), getMostRecentLeaf: () => inbox } } as unknown as App,
    isSupportedPlatform: () => true,
    getActiveLeaf: () => inbox,
    getLeaves: () => workspace.openLeaves,
    getPageInfo: (leaf) => ({ url: leaf.view.url, title: "", faviconUrl: "", mode: "webview" }),
  });
  return { manager, workspace };
}

describe("webViewerServiceState", () => {
  describe("WebViewerStateManager", () => {
    describe("getActiveWebTabLeaf()", () => {
      it("returns the web tab that active-tab tracking currently follows", () => {
        const { manager } = createManager([inbox]);
        manager.startActiveWebTabTracking();

        expect(manager.getActiveWebTabLeaf()).toBe(inbox);
      });

      it("returns null once that web tab is closed", () => {
        const { manager, workspace } = createManager([inbox]);
        manager.startActiveWebTabTracking();
        workspace.openLeaves = [];

        expect(manager.getActiveWebTabLeaf()).toBeNull();
      });
    });
  });
});
