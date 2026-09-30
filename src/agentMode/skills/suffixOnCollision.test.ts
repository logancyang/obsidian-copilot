import { suffixOnCollision } from "./suffixOnCollision";

describe("suffixOnCollision", () => {
  describe("suffixOnCollision()", () => {
    it("returns the original name when there is no collision", () => {
      expect(suffixOnCollision("foo", new Set())).toBe("foo");
      expect(suffixOnCollision("foo", new Set(["bar"]))).toBe("foo");
    });

    it("appends -2 on the first collision", () => {
      expect(suffixOnCollision("foo", new Set(["foo"]))).toBe("foo-2");
    });

    it("keeps incrementing until a free name is found", () => {
      expect(suffixOnCollision("foo", new Set(["foo", "foo-2", "foo-3"]))).toBe("foo-4");
    });

    it("appends a new -N suffix even when the source already ends in -N", () => {
      expect(suffixOnCollision("foo-2", new Set(["foo-2"]))).toBe("foo-2-2");
    });

    it("throws when no suffix fits within the 64-char cap", () => {
      const longName = "a".repeat(63);
      expect(() => suffixOnCollision(longName, new Set([longName]))).toThrow();
    });
  });
});
