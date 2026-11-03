import type { App } from "obsidian";

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

function createService(openLeaves: WebViewerLeaf[], mostRecent: WebViewerLeaf | null) {
  const app = {
    workspace: {
      getLeavesOfType: () => openLeaves,
      getMostRecentLeaf: () => mostRecent,
    },
  } as unknown as App;
  return new WebViewerService(app);
}

const inbox = createLeaf("https://mail.example.com/mail/inbox", "Inbox");
const sentItem = createLeaf("https://mail.example.com/mail/sentitems/id/second", "Sent Items");
const staleSentItemUrl = "https://mail.example.com/mail/sentitems/id/first";

describe("webViewerService", () => {
  describe("WebViewerService", () => {
    describe("findAttachedTabLeaf()", () => {
      it("returns the open tab whose URL matches the attached tab", () => {
        const service = createService([inbox, sentItem], inbox);

        expect(
          service.findAttachedTabLeaf(sentItem.view.url, { title: "Sent Items", isActive: true })
        ).toBe(sentItem);
      });

      it("returns the focused web tab for an active tab whose URL a single-page app changed in place (https://github.com/logancyang/obsidian-copilot/issues/3693)", () => {
        const service = createService([sentItem], sentItem);

        expect(
          service.findAttachedTabLeaf(staleSentItemUrl, { title: "Sent Items", isActive: true })
        ).toBe(sentItem);
      });

      it("returns the last focused web tab for a stale active tab once focus has left the web tab (https://github.com/logancyang/obsidian-copilot/issues/3693)", () => {
        const service = createService([sentItem], null);
        jest.spyOn(service, "getLastActiveLeaf").mockReturnValue(sentItem);

        expect(
          service.findAttachedTabLeaf(staleSentItemUrl, { title: "Sent Items", isActive: true })
        ).toBe(sentItem);
      });

      it("returns null for a non-active tab whose URL no open tab has, even while a web tab is focused", () => {
        const service = createService([sentItem], sentItem);

        expect(
          service.findAttachedTabLeaf("https://example.com/closed", { isActive: false })
        ).toBeNull();
      });
    });
  });
});
