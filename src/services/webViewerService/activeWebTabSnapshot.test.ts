import type { App } from "obsidian";

import { buildWebTabsWithActiveSnapshot } from "./activeWebTabSnapshot";
import { getWebViewerService } from "./webViewerServiceSingleton";

jest.mock("./webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));

const mockGetWebViewerService = getWebViewerService as jest.Mock;

// The helper only forwards `app` to the mocked service; an empty stub suffices.
const app = {} as App;

const mockActiveTab = (activeWebTabForMentions: unknown) => {
  mockGetWebViewerService.mockReturnValue({
    getActiveWebTabState: () => ({ activeWebTabForMentions }),
  });
};

describe("buildWebTabsWithActiveSnapshot", () => {
  beforeEach(() => {
    mockGetWebViewerService.mockReset();
  });

  it("returns sanitized tabs unchanged when not including the active tab", () => {
    const result = buildWebTabsWithActiveSnapshot(
      app,
      [{ url: "https://a.dev", title: "A" }],
      false
    );
    expect(result).toEqual([{ url: "https://a.dev", title: "A" }]);
    expect(mockGetWebViewerService).not.toHaveBeenCalled();
  });

  it("appends the active tab with isActive: true", () => {
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

  it("merges the active tab into a matching existing URL", () => {
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

  it("enforces a single isActive tab", () => {
    mockActiveTab({ url: "https://active.dev" });
    const result = buildWebTabsWithActiveSnapshot(
      app,
      [{ url: "https://other.dev", isActive: true }, { url: "https://active.dev" }],
      true
    );
    expect(result.filter((t) => t.isActive)).toHaveLength(1);
    expect(result.find((t) => t.isActive)?.url).toBe("https://active.dev");
  });

  it("returns sanitized tabs when there is no active tab", () => {
    mockActiveTab(null);
    const result = buildWebTabsWithActiveSnapshot(app, [{ url: "https://a.dev" }], true);
    expect(result).toEqual([{ url: "https://a.dev" }]);
  });

  it("does not throw when the Web Viewer service is unavailable", () => {
    mockGetWebViewerService.mockImplementation(() => {
      throw new Error("Web Viewer unsupported");
    });
    const result = buildWebTabsWithActiveSnapshot(app, [{ url: "https://a.dev" }], true);
    expect(result).toEqual([{ url: "https://a.dev" }]);
  });
});
