import type { App, WorkspaceLeaf } from "obsidian";

import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { WebViewerService } from "@/services/webViewerService/webViewerService";
import {
  WEB_VIEWER_VIEW_TYPE,
  type WebViewerLeaf,
} from "@/services/webViewerService/webViewerServiceTypes";

jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => true }));

function createLeaf(url: string, title: string): WebViewerLeaf {
  return {
    view: { url, title, getViewType: () => WEB_VIEWER_VIEW_TYPE },
  } as unknown as WebViewerLeaf;
}

const agentChatLeaf = {
  view: { getViewType: () => CHAT_AGENT_VIEWTYPE },
} as unknown as WorkspaceLeaf;

function createService(openLeaves: WebViewerLeaf[], mostRecent: WorkspaceLeaf | null) {
  const workspace = {
    mostRecent,
    openLeaves,
    activeLeafHandler: null as ((leaf: WorkspaceLeaf | null) => void) | null,
    getLeavesOfType: () => workspace.openLeaves,
    getMostRecentLeaf: () => workspace.mostRecent,
    on: (event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
      if (event === "active-leaf-change") workspace.activeLeafHandler = handler;
      return {};
    },
  };
  const service = new WebViewerService({ workspace } as unknown as App);
  const focus = (leaf: WorkspaceLeaf) => {
    workspace.mostRecent = leaf;
    workspace.activeLeafHandler?.(leaf);
  };
  const closeAll = () => {
    workspace.openLeaves = [];
  };
  return { service, focus, closeAll };
}

const inbox = createLeaf("https://mail.example.com/mail/inbox", "Inbox");
const sentItem = createLeaf("https://mail.example.com/mail/sentitems/id/second", "Sent Items");
const staleSentItemUrl = "https://mail.example.com/mail/sentitems/id/first";

describe("webViewerService", () => {
  describe("WebViewerService", () => {
    describe("findAttachedTabLeaf()", () => {
      it("returns the open tab whose URL matches the attached tab", () => {
        const { service } = createService([inbox, sentItem], inbox);

        expect(
          service.findAttachedTabLeaf(sentItem.view.url, { title: "Sent Items", isActive: true })
        ).toBe(sentItem);
      });

      it("returns the tracked active web tab for an active tab whose URL a single-page app changed in place, even after focus moved to Agent Chat without the web tab being focused since tracking started (https://github.com/logancyang/obsidian-copilot/issues/3693)", () => {
        const { service, focus } = createService([sentItem], sentItem);
        service.startActiveWebTabTracking({ preserveOnViewTypes: [CHAT_AGENT_VIEWTYPE] });
        focus(agentChatLeaf);

        expect(
          service.findAttachedTabLeaf(staleSentItemUrl, { title: "Sent Items", isActive: true })
        ).toBe(sentItem);
      });

      it("returns null for a stale active tab once its tracked web tab is closed", () => {
        const { service, closeAll } = createService([sentItem], sentItem);
        service.startActiveWebTabTracking();
        closeAll();

        expect(
          service.findAttachedTabLeaf(staleSentItemUrl, { title: "Sent Items", isActive: true })
        ).toBeNull();
      });

      it("returns null for a non-active tab whose URL no open tab has, even while a web tab is tracked", () => {
        const { service } = createService([sentItem], sentItem);
        service.startActiveWebTabTracking();

        expect(
          service.findAttachedTabLeaf("https://example.com/closed", { isActive: false })
        ).toBeNull();
      });
    });
  });
});
