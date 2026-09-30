import {
  normalizeUrlString,
  normalizeUrlForMatching,
  normalizeOptionalString,
  normalizeWebTabContext,
  mergeWebTabContexts,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";
import type { WebTabContext } from "@/types/message";

describe("urlNormalization", () => {
  describe("normalizeUrlString()", () => {
    it("returns the URL unchanged when it is already clean", () => {
      expect(normalizeUrlString("https://example.com/path")).toBe("https://example.com/path");
    });

    it("trims surrounding whitespace from the URL", () => {
      expect(normalizeUrlString("  https://example.com  ")).toBe("https://example.com");
    });

    it.each([null, undefined, "", "   "])("returns null for the blank input %j", (blank) => {
      expect(normalizeUrlString(blank)).toBeNull();
    });
  });

  describe("normalizeUrlForMatching()", () => {
    it("hash fragments are ignored when matching URLs", () => {
      expect(normalizeUrlForMatching("https://example.com/page#section1")).toBe(
        "https://example.com/page"
      );
      expect(normalizeUrlForMatching("https://example.com/page#section1")).toBe(
        normalizeUrlForMatching("https://example.com/page#section2")
      );
    });

    it("removes default ports but preserves non-default ones", () => {
      expect(normalizeUrlForMatching("https://example.com:443/path")).toBe(
        "https://example.com/path"
      );
      expect(normalizeUrlForMatching("http://example.com:80/path")).toBe("http://example.com/path");
      expect(normalizeUrlForMatching("https://example.com:8443/path")).toBe(
        "https://example.com:8443/path"
      );
    });

    it("strips trailing slashes from a path but keeps the root slash", () => {
      expect(normalizeUrlForMatching("https://example.com/path/")).toBe("https://example.com/path");
      expect(normalizeUrlForMatching("https://example.com/path//")).toBe(
        "https://example.com/path"
      );
      expect(normalizeUrlForMatching("https://example.com/")).toBe("https://example.com/");
    });

    it("sorts query parameters so reordered queries match the same page", () => {
      expect(normalizeUrlForMatching("https://example.com?b=2&a=1")).toBe(
        "https://example.com/?a=1&b=2"
      );
      expect(normalizeUrlForMatching("https://example.com/page?b=2&a=1")).toBe(
        normalizeUrlForMatching("https://example.com/page?a=1&b=2")
      );
    });

    it("returns the trimmed input when it is not a parseable URL", () => {
      expect(normalizeUrlForMatching("  not-a-url  ")).toBe("not-a-url");
    });

    it.each([null, undefined, ""])("returns null for the blank input %j", (blank) => {
      expect(normalizeUrlForMatching(blank)).toBeNull();
    });
  });

  describe("normalizeOptionalString()", () => {
    it("trims a non-blank string", () => {
      expect(normalizeOptionalString("  Title  ")).toBe("Title");
    });

    it.each([null, ""])("returns undefined for the blank input %j", (blank) => {
      expect(normalizeOptionalString(blank)).toBeUndefined();
    });
  });

  describe("normalizeWebTabContext()", () => {
    it("trims the URL, title and favicon URL", () => {
      const tab: WebTabContext = {
        url: "  https://example.com  ",
        title: "  Example  ",
        faviconUrl: "  https://example.com/favicon.ico  ",
      };

      expect(normalizeWebTabContext(tab)).toEqual({
        url: "https://example.com",
        title: "Example",
        faviconUrl: "https://example.com/favicon.ico",
        isLoaded: undefined,
        isActive: undefined,
      });
    });

    it("preserves isActive when true and isLoaded when false", () => {
      const result = normalizeWebTabContext({
        url: "https://example.com",
        isActive: true,
        isLoaded: false,
      });

      expect(result?.isActive).toBe(true);
      expect(result?.isLoaded).toBe(false);
    });

    it("drops a false isActive flag", () => {
      const result = normalizeWebTabContext({ url: "https://example.com", isActive: false });

      expect(result?.isActive).toBeUndefined();
    });

    it.each(["", "   "])("returns null for the blank URL %j", (url) => {
      expect(normalizeWebTabContext({ url, title: "Test" })).toBeNull();
    });
  });

  describe("mergeWebTabContexts()", () => {
    it("returns an empty array for empty input", () => {
      expect(mergeWebTabContexts([])).toEqual([]);
    });

    it("keeps one tab per URL in first-seen order", () => {
      const tabs: WebTabContext[] = [
        { url: "https://first.com" },
        { url: "https://second.com" },
        { url: "https://first.com", title: "Again" },
        { url: "https://third.com" },
      ];

      expect(mergeWebTabContexts(tabs).map((t) => t.url)).toEqual([
        "https://first.com",
        "https://second.com",
        "https://third.com",
      ]);
    });

    it("merges metadata across duplicates, preferring the later entry when both set a value", () => {
      const tabs: WebTabContext[] = [
        { url: "https://example.com", title: "First" },
        {
          url: "https://example.com",
          title: "Second",
          faviconUrl: "https://example.com/favicon.ico",
        },
      ];

      expect(mergeWebTabContexts(tabs)).toEqual([
        {
          url: "https://example.com",
          title: "Second",
          faviconUrl: "https://example.com/favicon.ico",
          isLoaded: undefined,
          isActive: undefined,
        },
      ]);
    });

    it("marks the merged tab active when any duplicate is active", () => {
      const tabs: WebTabContext[] = [
        { url: "https://example.com", isActive: false },
        { url: "https://example.com", isActive: true },
      ];

      expect(mergeWebTabContexts(tabs)[0].isActive).toBe(true);
    });

    it("drops tabs whose URL is blank", () => {
      const tabs: WebTabContext[] = [
        { url: "https://valid.com" },
        { url: "" },
        { url: "   " },
        { url: "https://another-valid.com" },
      ];

      expect(mergeWebTabContexts(tabs).map((t) => t.url)).toEqual([
        "https://valid.com",
        "https://another-valid.com",
      ]);
    });
  });

  describe("sanitizeWebTabContexts()", () => {
    it("normalizes and deduplicates tabs by URL", () => {
      const tabs: WebTabContext[] = [
        { url: "  https://example.com  " },
        { url: "https://example.com" },
      ];

      expect(sanitizeWebTabContexts(tabs).map((t) => t.url)).toEqual(["https://example.com"]);
    });

    it("keeps a single active tab as it is", () => {
      const tabs: WebTabContext[] = [
        { url: "https://first.com" },
        { url: "https://second.com", isActive: true },
        { url: "https://third.com" },
      ];

      expect(sanitizeWebTabContexts(tabs).map((t) => t.isActive)).toEqual([
        undefined,
        true,
        undefined,
      ]);
    });

    it("keeps only the first active tab when several claim to be active", () => {
      const tabs: WebTabContext[] = [
        { url: "https://first.com", isActive: true },
        { url: "https://second.com", isActive: true },
        { url: "https://third.com", isActive: true },
      ];

      const active = sanitizeWebTabContexts(tabs).filter((t) => t.isActive);

      expect(active.map((t) => t.url)).toEqual(["https://first.com"]);
    });
  });
});
