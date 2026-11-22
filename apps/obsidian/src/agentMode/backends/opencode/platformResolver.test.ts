import {
  buildAssetCandidates,
  expectedBinaryName,
  mapNodeArch,
  mapNodePlatform,
} from "./platformResolver";

describe("platformResolver", () => {
  describe("buildAssetCandidates()", () => {
    it("returns only the plain asset for darwin arm64", () => {
      expect(buildAssetCandidates({ platform: "darwin", arch: "arm64" })).toEqual([
        "opencode-darwin-arm64",
      ]);
    });

    it("returns only the plain asset for darwin x64 with avx2", () => {
      expect(buildAssetCandidates({ platform: "darwin", arch: "x64", hasAvx2: true })).toEqual([
        "opencode-darwin-x64",
      ]);
    });

    it("lists the baseline asset before the plain asset for darwin x64 without avx2", () => {
      expect(buildAssetCandidates({ platform: "darwin", arch: "x64", hasAvx2: false })).toEqual([
        "opencode-darwin-x64-baseline",
        "opencode-darwin-x64",
      ]);
    });

    it("returns only the plain asset for linux x64 glibc with avx2", () => {
      expect(
        buildAssetCandidates({ platform: "linux", arch: "x64", libc: "glibc", hasAvx2: true })
      ).toEqual(["opencode-linux-x64"]);
    });

    it("lists the baseline asset before the plain asset for linux x64 glibc without avx2", () => {
      expect(
        buildAssetCandidates({ platform: "linux", arch: "x64", libc: "glibc", hasAvx2: false })
      ).toEqual(["opencode-linux-x64-baseline", "opencode-linux-x64"]);
    });

    it("lists the musl asset before the plain asset for linux x64 musl with avx2", () => {
      expect(
        buildAssetCandidates({ platform: "linux", arch: "x64", libc: "musl", hasAvx2: true })
      ).toEqual(["opencode-linux-x64-musl", "opencode-linux-x64"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/560 lists the combined baseline-musl asset before its fallbacks for linux x64 musl without avx2", () => {
      expect(
        buildAssetCandidates({ platform: "linux", arch: "x64", libc: "musl", hasAvx2: false })
      ).toEqual([
        "opencode-linux-x64-baseline-musl",
        "opencode-linux-x64-musl",
        "opencode-linux-x64-baseline",
        "opencode-linux-x64",
      ]);
    });

    it("returns only the plain asset for linux arm64", () => {
      expect(buildAssetCandidates({ platform: "linux", arch: "arm64" })).toEqual([
        "opencode-linux-arm64",
      ]);
    });

    it("returns only the plain asset for windows x64", () => {
      expect(buildAssetCandidates({ platform: "windows", arch: "x64", hasAvx2: true })).toEqual([
        "opencode-windows-x64",
      ]);
    });

    it("returns no duplicate assets for linux arm64 glibc", () => {
      const candidates = buildAssetCandidates({
        platform: "linux",
        arch: "arm64",
        libc: "glibc",
      });
      expect(candidates.length).toBe(new Set(candidates).size);
    });
  });

  describe("mapNodePlatform()", () => {
    it.each([
      ["darwin", "darwin"],
      ["linux", "linux"],
      ["win32", "windows"],
    ])("maps node value %s to %s", (input, expected) => {
      expect(mapNodePlatform(input as NodeJS.Platform)).toBe(expected);
    });

    it("returns undefined for freebsd", () => {
      expect(mapNodePlatform("freebsd")).toBeUndefined();
    });
  });

  describe("mapNodeArch()", () => {
    it.each([
      ["x64", "x64"],
      ["arm64", "arm64"],
      ["arm", "arm"],
    ])("maps node value %s to %s", (input, expected) => {
      expect(mapNodeArch(input)).toBe(expected);
    });

    it("returns undefined for ia32", () => {
      expect(mapNodeArch("ia32")).toBeUndefined();
    });
  });

  describe("expectedBinaryName()", () => {
    it("appends .exe for windows", () => {
      expect(expectedBinaryName("windows")).toBe("opencode.exe");
    });
    it("omits the extension for darwin and linux", () => {
      expect(expectedBinaryName("darwin")).toBe("opencode");
      expect(expectedBinaryName("linux")).toBe("opencode");
    });
  });
});
