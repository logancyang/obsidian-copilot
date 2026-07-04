import {
  createUrlItem,
  extractUrlsFromText,
  normalizeUrl,
  parseProjectUrls,
  parseUrlsFromText,
  resolveInputUrls,
  serializeProjectUrls,
} from "@/utils/urlTagUtils";

describe("normalizeUrl", () => {
  it("prepends https:// to a bare host", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  it("leaves an explicit scheme untouched and trims", () => {
    expect(normalizeUrl("  http://example.com  ")).toBe("http://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
});

describe("createUrlItem", () => {
  it("normalizes the url and classifies a plain web page", () => {
    const item = createUrlItem("example.com/page");
    expect(item).toEqual({
      id: "web:https://example.com/page",
      url: "https://example.com/page",
      type: "web",
    });
  });

  it("classifies a YouTube video as youtube", () => {
    const item = createUrlItem("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(item.type).toBe("youtube");
  });

  it("produces a stable id for the same input", () => {
    expect(createUrlItem("example.com").id).toBe(createUrlItem("example.com").id);
  });
});

describe("parseUrlsFromText", () => {
  it("parses a single url", () => {
    const items = parseUrlsFromText("https://example.com");
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://example.com");
  });

  it("extracts every scheme-anchored url from a batch", () => {
    const items = parseUrlsFromText("https://example.com\nhttps://foo.org https://bar.net");
    expect(items.map((i) => i.url)).toEqual([
      "https://example.com",
      "https://foo.org",
      "https://bar.net",
    ]);
  });

  it("accepts a single bare host typed without a scheme", () => {
    const items = parseUrlsFromText("example.com");
    expect(items.map((i) => i.url)).toEqual(["https://example.com"]);
  });

  it("does NOT harvest bare-host tokens from a multi-token blob", () => {
    // The single biggest fix: prose tokens that look like hosts (`1.`,
    // `(context.urls)`, `Mention.mentions:`, a CJK sentence whose 。 folds to a
    // dot) must not become URLs when a document is pasted. Only the explicit
    // https:// link survives.
    const blob = [
      "1. first point",
      "see (context.urls) and Mention.mentions: for details",
      "这是现有架构的统一设计。",
      "real link https://anthropic.com/news",
    ].join("\n");
    expect(parseUrlsFromText(blob).map((i) => i.url)).toEqual(["https://anthropic.com/news"]);
  });

  it("dedups within the input and against existing urls (by normalized url)", () => {
    const items = parseUrlsFromText("https://example.com\nhttps://example.com\nhttps://foo.org", [
      "https://foo.org",
    ]);
    expect(items.map((i) => i.url)).toEqual(["https://example.com"]);
  });

  it("classifies web and youtube items", () => {
    const items = parseUrlsFromText("https://example.com\nhttps://youtu.be/dQw4w9WgXcQ");
    expect(items.find((i) => i.url.includes("example"))?.type).toBe("web");
    expect(items.find((i) => i.url.includes("youtu.be"))?.type).toBe("youtube");
  });

  it("round-trips through serialize/parseProjectUrls without loss", () => {
    const items = parseUrlsFromText(
      "https://example.com\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    const { webUrls, youtubeUrls } = serializeProjectUrls(items);
    const reparsed = parseProjectUrls(webUrls, youtubeUrls);
    expect(reparsed.map((i) => i.url).sort()).toEqual(items.map((i) => i.url).sort());
  });
});

describe("extractUrlsFromText", () => {
  it("only matches scheme-anchored urls, ignoring bare-host prose", () => {
    expect(extractUrlsFromText("ping example.com or 1. or (context.urls)")).toEqual([]);
    expect(extractUrlsFromText("go to https://example.com now")).toEqual(["https://example.com"]);
  });

  it("trims trailing sentence and CJK punctuation", () => {
    expect(extractUrlsFromText("see https://example.com.")).toEqual(["https://example.com"]);
    expect(extractUrlsFromText("链接 https://example.com，谢谢")).toEqual(["https://example.com"]);
  });

  it("drops an unbalanced trailing bracket but keeps balanced ones", () => {
    expect(extractUrlsFromText("(https://example.com)")).toEqual(["https://example.com"]);
    expect(extractUrlsFromText("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  it("re-trims punctuation a stripped bracket was hiding", () => {
    expect(extractUrlsFromText("(see https://example.com.)")).toEqual(["https://example.com"]);
  });

  it("handles a long unbalanced trailing bracket run without quadratic blowup", () => {
    // Perf tripwire: trimming used to re-split the whole string per stripped char
    // (O(n²)), freezing the main thread on a pathological paste. The linear
    // rewrite resolves this 100k-')' run instantly; reintroducing the quadratic
    // form would blow the test timeout. (Correctness of the rewrite itself is
    // covered by the small balanced/unbalanced cases above.)
    const url = "https://example.com";
    expect(extractUrlsFromText(`${url}${")".repeat(100_000)}`)).toEqual([url]);
  });

  it("strips markdown image/link wrappers down to the url", () => {
    expect(extractUrlsFromText('![alt](https://cdn.example.com/a.png "title")')).toEqual([
      "https://cdn.example.com/a.png",
    ]);
  });

  it("de-duplicates repeated urls", () => {
    expect(extractUrlsFromText("https://x.com https://x.com")).toEqual(["https://x.com"]);
  });
});

describe("resolveInputUrls", () => {
  it("returns scheme-anchored urls when present", () => {
    expect(resolveInputUrls("https://a.com bare.com")).toEqual(["https://a.com"]);
  });

  it("falls back to a single bare host with no scheme", () => {
    expect(resolveInputUrls("youtube.com/watch?v=x")).toEqual(["youtube.com/watch?v=x"]);
  });

  it("does not fall back for a multi-token bare-host blob", () => {
    expect(resolveInputUrls("foo.com bar.com")).toEqual([]);
  });
});
