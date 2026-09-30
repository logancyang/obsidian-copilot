import type { App } from "obsidian";

import { buildWebTabsWithActiveSnapshot } from "./activeWebTabSnapshot";
import { getWebViewerService } from "./webViewerServiceSingleton";

jest.mock("./webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));

const mockGetWebViewerService = getWebViewerService as jest.Mock;

const app = {} as App;

const mockActiveTab = (activeWebTabForMentions: unknown) => {
  mockGetWebViewerService.mockReturnValue({
    getActiveWebTabState: () => ({ activeWebTabForMentions }),
  });
};

describe("activeWebTabSnapshot", () => {
  beforeEach(() => {
    mockGetWebViewerService.mockReset();
  });

  describe("buildWebTabsWithActiveSnapshot()", () => {
    it("returns the given tabs unchanged, without reading the Web Viewer, when the active tab is not requested", () => {
      const result = buildWebTabsWithActiveSnapshot(
        app,
        [{ url: "https://a.dev", title: "A" }],
        false
      );
      expect(result).toEqual([{ url: "https://a.dev", title: "A" }]);
      expect(mockGetWebViewerService).not.toHaveBeenCalled();
    });

    it("appends the active Web Viewer tab marked isActive when its URL is not among the given tabs", () => {
      mockActiveTab({
        url: "https://active.dev",
        title: "Active",
        faviconUrl: "https://active.dev/f.ico",
      });
      const result = buildWebTabsWithActiveSnapshot(app, [{ url: "https://a.dev" }], true);
      expect(result).toContainEqual(
        expect.objectContaining({ url: "https://active.dev", isActive: true })
      );
      expect(result.filter((t) => t.isActive)).toHaveLength(1);
    });

    it("merges the active tab into the given tab that has the same URL", () => {
      mockActiveTab({ url: "https://same.dev", title: "New" });
      const result = buildWebTabsWithActiveSnapshot(
        app,
        [{ url: "https://same.dev", title: "Old" }],
        true
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({ url: "https://same.dev", title: "New", isActive: true })
      );
    });

    it("leaves only the active Web Viewer tab marked isActive", () => {
      mockActiveTab({ url: "https://active.dev" });
      const result = buildWebTabsWithActiveSnapshot(
        app,
        [{ url: "https://other.dev", isActive: true }, { url: "https://active.dev" }],
        true
      );
      expect(result.filter((t) => t.isActive)).toHaveLength(1);
      expect(result.find((t) => t.isActive)?.url).toBe("https://active.dev");
    });

    it("returns the given tabs when the Web Viewer has no active tab", () => {
      mockActiveTab(null);
      const result = buildWebTabsWithActiveSnapshot(app, [{ url: "https://a.dev" }], true);
      expect(result).toEqual([{ url: "https://a.dev" }]);
    });

    it("returns the given tabs instead of throwing when the Web Viewer service is unavailable", () => {
      mockGetWebViewerService.mockImplementation(() => {
        throw new Error("Web Viewer unsupported");
      });
      const result = buildWebTabsWithActiveSnapshot(app, [{ url: "https://a.dev" }], true);
      expect(result).toEqual([{ url: "https://a.dev" }]);
    });
  });
});
