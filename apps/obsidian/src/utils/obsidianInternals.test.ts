import { callMethod, isRecord, readProperty } from "@/utils/obsidianInternals";

describe("obsidianInternals", () => {
  describe("isRecord()", () => {
    it("accepts objects and rejects null and primitives", () => {
      expect(isRecord({ enabled: true })).toBe(true);
      expect(isRecord(document.createElement("div"))).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord("bookmarks")).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });
  });

  describe("readProperty()", () => {
    it("reads a property of an object", () => {
      expect(readProperty({ enabled: false }, "enabled")).toBe(false);
    });

    it("returns undefined instead of throwing when the target is not an object", () => {
      expect(readProperty(undefined, "internalPlugins")).toBeUndefined();
      expect(readProperty(null, "internalPlugins")).toBeUndefined();
      expect(readProperty(42, "internalPlugins")).toBeUndefined();
    });
  });

  describe("callMethod()", () => {
    it("calls the named method on its object with the given arguments and returns its result", () => {
      const registry = {
        prefix: "core:",
        getPluginById(this: { prefix: string }, id: string) {
          return `${this.prefix}${id}`;
        },
      };

      expect(callMethod(registry, "getPluginById", "bookmarks")).toBe("core:bookmarks");
    });

    it("returns undefined without calling anything when the method is missing or not a function", () => {
      expect(callMethod({}, "getPluginById", "bookmarks")).toBeUndefined();
      expect(callMethod({ getPluginById: "bookmarks" }, "getPluginById")).toBeUndefined();
      expect(callMethod(undefined, "getPluginById")).toBeUndefined();
    });
  });
});
