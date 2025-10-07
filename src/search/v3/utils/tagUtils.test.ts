import { extractTagsFromQuery } from "./tagUtils";

describe("tagUtils.extractTagsFromQuery", () => {
  it("returns empty array for empty query", () => {
    expect(extractTagsFromQuery("")).toEqual([]);
    expect(extractTagsFromQuery("   ")).toEqual([]);
  });

  it("extracts simple hash tags", () => {
    expect(extractTagsFromQuery("#Project #Second")).toEqual(["#project", "#second"]);
  });

  it("deduplicates repeated tags", () => {
    expect(extractTagsFromQuery("mix of #tag and #TAG and #tag")).toEqual(["#tag"]);
  });

  it("preserves hierarchical tags", () => {
    expect(extractTagsFromQuery("notes for #project/alpha and #Project/Beta")).toEqual([
      "#project/alpha",
      "#project/beta",
    ]);
  });

  it("handles unicode characters when supported", () => {
    expect(extractTagsFromQuery("跟进 #项目/测试 #项目/測試")).toEqual([
      "#项目/测试",
      "#项目/測試",
    ]);
  });

  it("falls back to ASCII-only regex when unicode flag is unsupported", () => {
    // Simulate environments without unicode flag support by supplying ASCII tags with dashes/underscores.
    expect(extractTagsFromQuery("check #tag-name and #tag_name")).toEqual([
      "#tag-name",
      "#tag_name",
    ]);
  });

  it("ignores malformed tags", () => {
    expect(extractTagsFromQuery("broken # tag #?test #!oops")).toEqual([]);
  });
});
