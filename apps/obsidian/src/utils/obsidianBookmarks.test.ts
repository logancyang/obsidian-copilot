import {
  getUrlBookmarks,
  isBookmarksPluginDisabled,
  openBookmarksPluginSettings,
} from "@/utils/obsidianBookmarks";
import type { App } from "obsidian";

interface FakeItem {
  type: string;
  url?: string;
  title?: string;
  ctime?: number;
}

function makeBookmarksInstance(items: FakeItem[] = []) {
  const instance = {
    items,
    urlBookmarkLookup: {} as Record<string, FakeItem>,
    addItem: jest.fn((item: FakeItem) => {
      instance.items.push(item);
      rebuild();
    }),
    removeItem: jest.fn((item: FakeItem) => {
      instance.items.splice(instance.items.indexOf(item), 1);
      rebuild();
    }),
  };
  const rebuild = () => {
    instance.urlBookmarkLookup = Object.fromEntries(
      instance.items
        .filter((item) => item.type === "url")
        .map((item): [string, FakeItem] => [item.url ?? "", item])
    );
  };
  rebuild();
  return instance;
}

function appWithBookmarks(instance: unknown): App {
  return {
    internalPlugins: {
      getEnabledPluginById: (id: string) => (id === "bookmarks" ? instance : null),
    },
  } as unknown as App;
}

function requireUrlBookmarks(app: App) {
  const bookmarks = getUrlBookmarks(app);
  if (!bookmarks) throw new Error("Bookmarks are unavailable");
  return bookmarks;
}

const CHAT_URL = "obsidian://copilot-chat?vault=Notes&id=epoch%3A1000";

describe("obsidianBookmarks", () => {
  describe("getUrlBookmarks()", () => {
    afterEach(() => jest.restoreAllMocks());

    it("reports a URL as bookmarked only when the Bookmarks pane holds a URL bookmark for it", () => {
      const bookmarks = requireUrlBookmarks(
        appWithBookmarks(makeBookmarksInstance([{ type: "url", url: CHAT_URL, title: "Plan" }]))
      );

      expect(bookmarks.has(CHAT_URL)).toBe(true);
      expect(bookmarks.has("obsidian://copilot-chat?vault=Notes&id=epoch%3A2000")).toBe(false);
    });

    it("adds a URL bookmark with the given title and creation time at the root of the Bookmarks pane", () => {
      jest.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
      const instance = makeBookmarksInstance();

      requireUrlBookmarks(appWithBookmarks(instance)).add(CHAT_URL, "Plan the launch");

      expect(instance.addItem).toHaveBeenCalledWith({
        type: "url",
        url: CHAT_URL,
        title: "Plan the launch",
        ctime: 1_760_000_000_000,
      });
      expect(instance.addItem.mock.calls[0]).toHaveLength(1);
    });

    it("removes the URL bookmark that points at the URL and leaves other bookmarks", () => {
      const other: FakeItem = { type: "url", url: "https://example.com", title: "Docs" };
      const chat: FakeItem = { type: "url", url: CHAT_URL, title: "Plan" };
      const instance = makeBookmarksInstance([other, chat]);

      requireUrlBookmarks(appWithBookmarks(instance)).remove(CHAT_URL);

      expect(instance.removeItem).toHaveBeenCalledWith(chat);
      expect(instance.items).toEqual([other]);
    });

    it("removes nothing when no bookmark points at the URL", () => {
      const instance = makeBookmarksInstance([{ type: "url", url: "https://example.com" }]);

      requireUrlBookmarks(appWithBookmarks(instance)).remove(CHAT_URL);

      expect(instance.removeItem).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 returns null when the Bookmarks core plugin is disabled", () => {
      expect(getUrlBookmarks(appWithBookmarks(null))).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 returns null when the Bookmarks plugin no longer has the expected shape", () => {
      expect(
        getUrlBookmarks(appWithBookmarks({ ...makeBookmarksInstance(), removeItem: undefined }))
      ).toBeNull();
      expect(
        getUrlBookmarks(appWithBookmarks({ ...makeBookmarksInstance(), urlBookmarkLookup: null }))
      ).toBeNull();
      expect(getUrlBookmarks({} as App)).toBeNull();
    });
  });

  describe("isBookmarksPluginDisabled()", () => {
    function appWithPluginEntry(entry: unknown): App {
      return {
        internalPlugins: { getPluginById: (id: string) => (id === "bookmarks" ? entry : null) },
      } as unknown as App;
    }

    it("reports the Bookmarks core plugin as disabled only when Obsidian marks it turned off", () => {
      expect(isBookmarksPluginDisabled(appWithPluginEntry({ enabled: false }))).toBe(true);
      expect(isBookmarksPluginDisabled(appWithPluginEntry({ enabled: true }))).toBe(false);
    });

    it("reports nothing disabled when Obsidian's plugin registry is missing or has another shape", () => {
      expect(isBookmarksPluginDisabled({} as App)).toBe(false);
      expect(isBookmarksPluginDisabled(appWithPluginEntry(null))).toBe(false);
      expect(
        isBookmarksPluginDisabled({
          internalPlugins: { getPluginById: "bookmarks" },
        } as unknown as App)
      ).toBe(false);
    });
  });

  describe("openBookmarksPluginSettings()", () => {
    function settingsApp(pluginName: unknown) {
      const search = document.createElement("input");
      search.type = "search";
      const containerEl = document.createElement("div");
      containerEl.appendChild(search);
      const setting = { open: jest.fn(), openTabById: jest.fn(), activeTab: { containerEl } };
      const app = {
        setting,
        internalPlugins: {
          getPluginById: () => ({ enabled: false, instance: { name: pluginName } }),
        },
      } as unknown as App;
      return { app, setting, search };
    }

    it("opens Settings at Core plugins searched for the Bookmarks plugin's display name", () => {
      const { app, setting, search } = settingsApp("Lesezeichen");

      openBookmarksPluginSettings(app);

      expect(setting.open).toHaveBeenCalled();
      expect(setting.openTabById).toHaveBeenCalledWith("plugins");
      expect(search.value).toBe("Lesezeichen");
    });

    it("leaves the Core plugins search empty when the plugin has no display name", () => {
      const { app, search } = settingsApp(undefined);

      openBookmarksPluginSettings(app);

      expect(search.value).toBe("");
    });
  });
});
