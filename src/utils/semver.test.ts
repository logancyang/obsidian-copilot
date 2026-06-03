import { compareSemver } from "./semver";

describe("compareSemver", () => {
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
