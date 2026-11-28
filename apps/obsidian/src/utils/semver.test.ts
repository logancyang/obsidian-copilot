import { compareSemver, parseSemver } from "@/utils/semver";

describe("semver", () => {
  describe("compareSemver()", () => {
    it("orders by major, minor, then patch", () => {
      expect(compareSemver("1.15.11", "1.15.13")).toBeLessThan(0);
      expect(compareSemver("1.15.13", "1.15.11")).toBeGreaterThan(0);
      expect(compareSemver("1.16.0", "1.15.13")).toBeGreaterThan(0);
      expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    });

    it("returns 0 for equal versions", () => {
      expect(compareSemver("1.15.13", "1.15.13")).toBe(0);
    });

    it("ignores a leading v and any prerelease/build suffix", () => {
      expect(compareSemver("v1.15.13", "1.15.13")).toBe(0);
      expect(compareSemver("1.15.13-beta.1", "1.15.13")).toBe(0);
      expect(compareSemver("1.15.13+build.7", "1.15.13")).toBe(0);
    });

    it("treats an unparseable version as the lowest (behind everything)", () => {
      expect(compareSemver("garbage", "1.15.13")).toBeLessThan(0);
      expect(compareSemver("", "0.0.1")).toBeLessThan(0);
    });
  });

  describe("parseSemver()", () => {
    it("returns numeric components for a stable version", () => {
      expect(parseSemver("1.20.3")).toEqual({
        major: 1,
        minor: 20,
        patch: 3,
        prerelease: undefined,
      });
    });

    it("retains prerelease identifiers and accepts build metadata", () => {
      expect(parseSemver("1.2.3-beta.1+build.7")).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: "beta.1",
      });
      expect(parseSemver("0.0.0+build.7")).toEqual({
        major: 0,
        minor: 0,
        patch: 0,
        prerelease: undefined,
      });
    });

    it.each(["", "garbage", "1.2", "v1.2.3", "cli 1.2.3", "1.2.3 ", "01.2.3", "1.2.3-", "1.2.3+"])(
      "rejects invalid package metadata %j, https://github.com/Brevilabs/obsidian-copilot-private/issues/535",
      (version) => {
        expect(parseSemver(version)).toBeNull();
      }
    );
  });
});
