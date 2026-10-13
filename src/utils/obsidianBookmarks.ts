import { openCorePluginSettings } from "@/settings/openSettings";
import { callMethod, isRecord, readProperty } from "@/utils/obsidianInternals";
import type { App } from "obsidian";

export interface UrlBookmarks {
  has(url: string): boolean;
  add(url: string, title: string): void;
  remove(url: string): void;
}

function getBookmarksPlugin(app: App, lookup: "getPluginById" | "getEnabledPluginById"): unknown {
  return callMethod(readProperty(app, "internalPlugins"), lookup, "bookmarks");
}

export function getUrlBookmarks(app: App): UrlBookmarks | null {
  const instance = getBookmarksPlugin(app, "getEnabledPluginById");
  // The Bookmarks core plugin has no public API, so a changed shape must hide bookmarking rather than throw.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
  if (
    !isRecord(instance) ||
    typeof instance.addItem !== "function" ||
    typeof instance.removeItem !== "function" ||
    !isRecord(instance.urlBookmarkLookup)
  ) {
    return null;
  }
  const findBookmark = (url: string) => readProperty(instance.urlBookmarkLookup, url);
  return {
    has: (url) => findBookmark(url) !== undefined,
    add: (url, title) => {
      callMethod(instance, "addItem", { type: "url", url, title, ctime: Date.now() });
    },
    remove: (url) => {
      const item = findBookmark(url);
      if (item) callMethod(instance, "removeItem", item);
    },
  };
}

export function isBookmarksPluginDisabled(app: App): boolean {
  return readProperty(getBookmarksPlugin(app, "getPluginById"), "enabled") === false;
}

export function openBookmarksPluginSettings(app: App): void {
  const name = readProperty(
    readProperty(getBookmarksPlugin(app, "getPluginById"), "instance"),
    "name"
  );
  openCorePluginSettings(app, typeof name === "string" ? name : "");
}
