import {
  buildAssetCandidates,
  expectedBinaryName,
  mapNodeArch,
  mapNodePlatform,
} from "./platformResolver";

describe("buildAssetCandidates", () => {
  it("darwin arm64 → single candidate", () => {
    expect(buildAssetCandidates({ platform: "darwin", arch: "arm64" })).toEqual([
      "opencode-darwin-arm64",
    ]);
  });

  it("darwin x64 with avx2 → single candidate (no baseline)", () => {
    expect(buildAssetCandidates({ platform: "darwin", arch: "x64", hasAvx2: true })).toEqual([
      "opencode-darwin-x64",
    ]);
  });

  it("darwin x64 without avx2 → baseline first, regular as fallback", () => {
    expect(buildAssetCandidates({ platform: "darwin", arch: "x64", hasAvx2: false })).toEqual([
      "opencode-darwin-x64-baseline",
      "opencode-darwin-x64",
    ]);
  });

  it("linux x64 glibc with avx2 → single candidate", () => {
    expect(
      buildAssetCandidates({ platform: "linux", arch: "x64", libc: "glibc", hasAvx2: true })
    ).toEqual(["opencode-linux-x64"]);
  });

  it("linux x64 glibc without avx2 → baseline first, regular as fallback", () => {
    expect(
      buildAssetCandidates({ platform: "linux", arch: "x64", libc: "glibc", hasAvx2: false })
    ).toEqual(["opencode-linux-x64-baseline", "opencode-linux-x64"]);
  });

  it("linux x64 musl with avx2 → musl first, regular as fallback", () => {
    expect(
      buildAssetCandidates({ platform: "linux", arch: "x64", libc: "musl", hasAvx2: true })
    ).toEqual(["opencode-linux-x64-musl", "opencode-linux-x64"]);
  });

  it("linux x64 musl without avx2 → musl, baseline, regular", () => {
    expect(
      buildAssetCandidates({ platform: "linux", arch: "x64", libc: "musl", hasAvx2: false })
    ).toEqual(["opencode-linux-x64-musl", "opencode-linux-x64-baseline", "opencode-linux-x64"]);
  });

  it("linux arm64 → single candidate", () => {
    expect(buildAssetCandidates({ platform: "linux", arch: "arm64" })).toEqual([
      "opencode-linux-arm64",
    ]);
  });

  it("windows x64 → single candidate", () => {
    expect(buildAssetCandidates({ platform: "windows", arch: "x64", hasAvx2: true })).toEqual([
      "opencode-windows-x64",
    ]);
  });

  it("does not duplicate candidates", () => {
    const candidates = buildAssetCandidates({
      platform: "linux",
      arch: "arm64",
      libc: "glibc",
    });
    expect(candidates.length).toBe(new Set(candidates).size);
  });
});

describe("mapNodePlatform", () => {
  it.each([
    ["darwin", "darwin"],
    ["linux", "linux"],
    ["win32", "windows"],
  ])("%s → %s", (input, expected) => {
    expect(mapNodePlatform(input as NodeJS.Platform)).toBe(expected);
  });

  it("returns undefined for unsupported platforms", () => {
    expect(mapNodePlatform("freebsd" as NodeJS.Platform)).toBeUndefined();
  });
});

describe("mapNodeArch", () => {
  it.each([
    ["x64", "x64"],
    ["arm64", "arm64"],
    ["arm", "arm"],
  ])("%s → %s", (input, expected) => {
    expect(mapNodeArch(input as string)).toBe(expected);
  });

  it("returns undefined for unsupported archs", () => {
    expect(mapNodeArch("ia32" as string)).toBeUndefined();
  });
});

describe("expectedBinaryName", () => {
  it("appends .exe on windows", () => {
    expect(expectedBinaryName("windows")).toBe("opencode.exe");
  });
  it("plain on darwin/linux", () => {
    expect(expectedBinaryName("darwin")).toBe("opencode");
    expect(expectedBinaryName("linux")).toBe("opencode");
  });
});
