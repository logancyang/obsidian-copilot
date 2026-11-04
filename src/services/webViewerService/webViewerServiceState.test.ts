import type { App, WorkspaceLeaf } from "obsidian";

import { WebViewerStateManager } from "@/services/webViewerService/webViewerServiceState";
import {
  WEB_VIEWER_VIEW_TYPE,
  type WebViewerLeaf,
} from "@/services/webViewerService/webViewerServiceTypes";

const inbox = {
  view: { url: "https://mail.example.com/inbox", getViewType: () => WEB_VIEWER_VIEW_TYPE },
} as unknown as WebViewerLeaf;
const docs = {
  view: { url: "https://docs.example.com/", getViewType: () => WEB_VIEWER_VIEW_TYPE },
} as unknown as WebViewerLeaf;
const chat = { view: { getViewType: () => "copilot-agent-chat-view" } } as unknown as WorkspaceLeaf;
const note = { view: { getViewType: () => "markdown" } } as unknown as WorkspaceLeaf;

function createManager(openLeaves: WebViewerLeaf[]) {
  const workspace = { openLeaves, activeLeaf: inbox as WorkspaceLeaf };
  let onActiveLeafChange: (leaf: WorkspaceLeaf | null) => void = () => {};
  const manager = new WebViewerStateManager({
    app: {
      workspace: {
        on: (name: string, callback: (leaf: WorkspaceLeaf | null) => void) => {
          if (name === "active-leaf-change") onActiveLeafChange = callback;
          return {};
        },
        getMostRecentLeaf: () => workspace.activeLeaf,
      },
    } as unknown as App,
    isSupportedPlatform: () => true,
    getActiveLeaf: () =>
      workspace.activeLeaf.view.getViewType() === WEB_VIEWER_VIEW_TYPE
        ? (workspace.activeLeaf as WebViewerLeaf)
        : null,
    getLeaves: () => workspace.openLeaves,
    getPageInfo: (leaf) => ({ url: leaf.view.url, title: "", faviconUrl: "", mode: "webview" }),
  });
  const activate = (leaf: WorkspaceLeaf) => {
    workspace.activeLeaf = leaf;
    onActiveLeafChange(leaf);
  };
  return { manager, workspace, activate };
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

    describe("startActiveWebTabTracking()", () => {
      it("passes the web tab to onWebTabLeave once when the user moves from it to another leaf https://github.com/Brevilabs/obsidian-copilot-private/issues/844", () => {
        const onWebTabLeave = jest.fn();
        const { manager, activate } = createManager([inbox]);
        manager.startActiveWebTabTracking({ onWebTabLeave });

        activate(chat);
        activate(note);

        expect(onWebTabLeave.mock.calls).toEqual([[inbox]]);
      });

      it("passes the web tab the user left when they switch straight to another web tab https://github.com/Brevilabs/obsidian-copilot-private/issues/844", () => {
        const onWebTabLeave = jest.fn();
        const { manager, activate } = createManager([inbox, docs]);
        manager.startActiveWebTabTracking({ onWebTabLeave });

        activate(docs);
        activate(chat);

        expect(onWebTabLeave.mock.calls).toEqual([[inbox], [docs]]);
      });

      it("does not call onWebTabLeave for a web tab the user closed, leaving its attached selection in place https://github.com/Brevilabs/obsidian-copilot-private/issues/844", () => {
        const onWebTabLeave = jest.fn();
        const closing = {
          view: { url: "https://example.com/", getViewType: () => WEB_VIEWER_VIEW_TYPE },
        } as unknown as WebViewerLeaf;
        const { manager, workspace, activate } = createManager([inbox, closing]);
        workspace.activeLeaf = closing;
        manager.startActiveWebTabTracking({ onWebTabLeave });

        closing.view.getViewType = () => "empty";
        activate(inbox);

        expect(onWebTabLeave).not.toHaveBeenCalled();
      });

      it("does not call onWebTabLeave while focus moves between leaves that are not web tabs https://github.com/Brevilabs/obsidian-copilot-private/issues/844", () => {
        const onWebTabLeave = jest.fn();
        const { manager, workspace, activate } = createManager([inbox]);
        workspace.activeLeaf = note;
        manager.startActiveWebTabTracking({ onWebTabLeave });

        activate(chat);
        activate(note);

        expect(onWebTabLeave).not.toHaveBeenCalled();
      });
    });
  });
});
