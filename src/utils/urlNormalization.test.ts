/**
 * Tests for URL normalization utilities
 *
 * Verifies that web tab contexts are correctly normalized, merged, and deduplicated.
 */

import {
  normalizeUrlString,
  normalizeUrlForMatching,
  normalizeOptionalString,
  normalizeWebTabContext,
  mergeWebTabContexts,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";
import type { WebTabContext } from "@/types/message";

describe("normalizeUrlString", () => {
  it("should return null for null input", () => {
    expect(normalizeUrlString(null)).toBeNull();
  });

  it("should return null for undefined input", () => {
    expect(normalizeUrlString(undefined)).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(normalizeUrlString("")).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    expect(normalizeUrlString("   ")).toBeNull();
  });

  it("should trim whitespace from URL", () => {
    expect(normalizeUrlString("  https://example.com  ")).toBe("https://example.com");
  });

  it("should return valid URL as-is", () => {
    expect(normalizeUrlString("https://example.com/path")).toBe("https://example.com/path");
  });
});

describe("normalizeUrlForMatching", () => {
  it("should return null for null input", () => {
    expect(normalizeUrlForMatching(null)).toBeNull();
  });

  it("should return null for undefined input", () => {
    expect(normalizeUrlForMatching(undefined)).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(normalizeUrlForMatching("")).toBeNull();
  });

  it("should remove hash fragments", () => {
    expect(normalizeUrlForMatching("https://example.com/page#section1")).toBe(
      "https://example.com/page"
    );
    expect(normalizeUrlForMatching("https://example.com/page#section2")).toBe(
      "https://example.com/page"
    );
  });

  it("should remove default ports", () => {
    expect(normalizeUrlForMatching("https://example.com:443/path")).toBe(
      "https://example.com/path"
    );
    expect(normalizeUrlForMatching("http://example.com:80/path")).toBe("http://example.com/path");
  });

  it("should preserve non-default ports", () => {
    expect(normalizeUrlForMatching("https://example.com:8443/path")).toBe(
      "https://example.com:8443/path"
    );
  });

  it("should normalize trailing slashes", () => {
    expect(normalizeUrlForMatching("https://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrlForMatching("https://example.com/path//")).toBe("https://example.com/path");
  });

  it("should preserve root path trailing slash", () => {
    expect(normalizeUrlForMatching("https://example.com/")).toBe("https://example.com/");
  });

  it("should sort query parameters", () => {
    expect(normalizeUrlForMatching("https://example.com?b=2&a=1")).toBe(
      "https://example.com/?a=1&b=2"
    );
    expect(normalizeUrlForMatching("https://example.com?a=1&b=2")).toBe(
      "https://example.com/?a=1&b=2"
    );
  });

  it("should match same page with different hash fragments", () => {
    const url1 = normalizeUrlForMatching("https://example.com/page#section1");
    const url2 = normalizeUrlForMatching("https://example.com/page#section2");
    expect(url1).toBe(url2);
  });

  it("should match same page with reordered query params", () => {
    const url1 = normalizeUrlForMatching("https://example.com/page?a=1&b=2");
    const url2 = normalizeUrlForMatching("https://example.com/page?b=2&a=1");
    expect(url1).toBe(url2);
  });

  it("should return trimmed string for invalid URLs", () => {
    expect(normalizeUrlForMatching("  not-a-url  ")).toBe("not-a-url");
  });
});

describe("normalizeOptionalString", () => {
  it("should return undefined for null input", () => {
    expect(normalizeOptionalString(null)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(normalizeOptionalString("")).toBeUndefined();
  });

  it("should trim and return valid string", () => {
    expect(normalizeOptionalString("  Title  ")).toBe("Title");
  });
});

describe("normalizeWebTabContext", () => {
  it("should return null for empty URL", () => {
    const tab: WebTabContext = { url: "", title: "Test" };
    expect(normalizeWebTabContext(tab)).toBeNull();
  });

  it("should return null for whitespace-only URL", () => {
    const tab: WebTabContext = { url: "   ", title: "Test" };
    expect(normalizeWebTabContext(tab)).toBeNull();
  });

  it("should normalize URL and metadata", () => {
    const tab: WebTabContext = {
      url: "  https://example.com  ",
      title: "  Example  ",
      faviconUrl: "  https://example.com/favicon.ico  ",
    };

    const result = normalizeWebTabContext(tab);

    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      faviconUrl: "https://example.com/favicon.ico",
      isLoaded: undefined,
      isActive: undefined,
    });
  });

  it("should preserve isActive flag when true", () => {
    const tab: WebTabContext = {
      url: "https://example.com",
      isActive: true,
    };

    const result = normalizeWebTabContext(tab);

    expect(result?.isActive).toBe(true);
  });

  it("should convert falsy isActive to undefined", () => {
    const tab: WebTabContext = {
      url: "https://example.com",
      isActive: false,
    };

    const result = normalizeWebTabContext(tab);

    expect(result?.isActive).toBeUndefined();
  });

  it("should preserve isLoaded flag", () => {
    const tab: WebTabContext = {
      url: "https://example.com",
      isLoaded: false,
    };

    const result = normalizeWebTabContext(tab);

    expect(result?.isLoaded).toBe(false);
  });
});

describe("mergeWebTabContexts", () => {
  it("should return empty array for empty input", () => {
    expect(mergeWebTabContexts([])).toEqual([]);
  });

  it("should deduplicate tabs by URL", () => {
    const tabs: WebTabContext[] = [
      { url: "https://example.com", title: "First" },
      { url: "https://example.com", title: "Second" },
    ];

    const result = mergeWebTabContexts(tabs);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("should preserve insertion order", () => {
    const tabs: WebTabContext[] = [
      { url: "https://first.com" },
      { url: "https://second.com" },
      { url: "https://third.com" },
    ];

    const result = mergeWebTabContexts(tabs);

    expect(result.map((t) => t.url)).toEqual([
      "https://first.com",
      "https://second.com",
      "https://third.com",
    ]);
  });

  it("should merge metadata from later entries", () => {
    const tabs: WebTabContext[] = [
      { url: "https://example.com", title: "First" },
      { url: "https://example.com", faviconUrl: "https://example.com/favicon.ico" },
    ];

    const result = mergeWebTabContexts(tabs);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      url: "https://example.com",
      title: "First",
      faviconUrl: "https://example.com/favicon.ico",
      isLoaded: undefined,
      isActive: undefined,
    });
  });

  it("should set isActive true if any merged entry is active", () => {
    const tabs: WebTabContext[] = [
      { url: "https://example.com", isActive: false },
      { url: "https://example.com", isActive: true },
    ];

    const result = mergeWebTabContexts(tabs);

    expect(result[0].isActive).toBe(true);
  });

  it("should filter out tabs with invalid URLs", () => {
    const tabs: WebTabContext[] = [
      { url: "https://valid.com" },
      { url: "" },
      { url: "   " },
      { url: "https://another-valid.com" },
    ];

    const result = mergeWebTabContexts(tabs);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.url)).toEqual(["https://valid.com", "https://another-valid.com"]);
  });
});

describe("sanitizeWebTabContexts", () => {
  it("should deduplicate and normalize tabs", () => {
    const tabs: WebTabContext[] = [
      { url: "  https://example.com  " },
      { url: "https://example.com" },
    ];

    const result = sanitizeWebTabContexts(tabs);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("should ensure only one tab has isActive=true", () => {
    const tabs: WebTabContext[] = [
      { url: "https://first.com", isActive: true },
      { url: "https://second.com", isActive: true },
      { url: "https://third.com", isActive: true },
    ];

    const result = sanitizeWebTabContexts(tabs);

    const activeTabs = result.filter((t) => t.isActive);
    expect(activeTabs).toHaveLength(1);
    expect(activeTabs[0].url).toBe("https://first.com");
  });

  it("should preserve single isActive flag", () => {
    const tabs: WebTabContext[] = [
      { url: "https://first.com" },
      { url: "https://second.com", isActive: true },
      { url: "https://third.com" },
    ];

    const result = sanitizeWebTabContexts(tabs);

    expect(result.find((t) => t.url === "https://second.com")?.isActive).toBe(true);
    expect(result.find((t) => t.url === "https://first.com")?.isActive).toBeUndefined();
    expect(result.find((t) => t.url === "https://third.com")?.isActive).toBeUndefined();
  });
});
