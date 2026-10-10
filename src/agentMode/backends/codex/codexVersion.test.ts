import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildCodexAcpInvocation,
  bundledCodexRuntimePath,
  resolveCodexCommand,
  inspectCodexAcpPackage,
  CODEX_MIN_VERSION,
  isSupportedCodexAcpPath,
  resolveSupportedCodexAcpPackage,
  resolveSupportedCodexAcpEntry,
  type CodexAcpPackageFs,
} from "./codexVersion";

const UNIX_ENTRY = "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js";
const NPM_CODEX_LAUNCHER =
  "/npm/lib/node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex/bin/codex.js";
const DIRECT_RUNTIME_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/686";
const tempDirs: string[] = [];

function packageFs(entryPath: string, packageMetadata: unknown): CodexAcpPackageFs {
  return {
    realpathSync: jest.fn().mockReturnValue(entryPath),
    readFileSync: jest.fn().mockReturnValue(JSON.stringify(packageMetadata)),
    resolveFrom: jest.fn().mockReturnValue(NPM_CODEX_LAUNCHER),
  };
}

function metadata(version: string) {
  return {
    name: "@agentclientprotocol/codex-acp",
    version,
    bin: { "codex-acp": "dist/index.js" },
  };
}

function installedAdapterPath(packageMetadata: unknown): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-acp-test-"));
  tempDirs.push(tempDir);
  const packageRoot = path.join(tempDir, "node_modules", "@agentclientprotocol", "codex-acp");
  const entryPath = path.join(packageRoot, "dist", "index.js");
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, "");
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify(packageMetadata));
  const launcherPath = path.join(tempDir, "codex-acp");
  fs.symlinkSync(entryPath, launcherPath);
  return launcherPath;
}

describe("codexVersion", () => {
  describe("inspectCodexAcpPackage()", () => {
    it.each(["0.0.44", "0.0.45", "0.0.46", "0.0.45-beta.1"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/535 inspects valid npm version %s independently of the minimum",
      (version) => {
        expect(
          inspectCodexAcpPackage(UNIX_ENTRY, "darwin", packageFs(UNIX_ENTRY, metadata(version)))
        ).toEqual({ entryPath: UNIX_ENTRY, version, runtimeVersion: version, kind: "npm" });
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/535 retains the actual runtime version separately from native packaging revisions", () => {
      const entry = "/bundle/codex-acp";
      expect(
        inspectCodexAcpPackage(
          entry,
          "darwin",
          packageFs(entry, {
            acpVersion: "0.0.44",
            packagingRevision: 1,
            target: `darwin-${process.arch}`,
          })
        )
      ).toEqual({
        entryPath: entry,
        version: "0.0.44-r1",
        runtimeVersion: "0.0.44",
        kind: "bundle",
      });
    });
  });
  describe("resolveSupportedCodexAcpPackage()", () => {
    it("returns the validated version of a user-owned npm package", () => {
      const packageFileSystem = packageFs(UNIX_ENTRY, metadata("2.0.0"));

      expect(
        resolveSupportedCodexAcpPackage("/usr/local/bin/codex-acp", "darwin", packageFileSystem)
      ).toEqual({ entryPath: UNIX_ENTRY, version: "2.0.0", kind: "npm" });
    });
    it.each(["darwin", "linux", "win32"] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 resolves a pinned native bundle on %s",
      (platform) => {
        const entry = platform === "win32" ? "C:\\bundle\\codex-acp.exe" : "/bundle/codex-acp";
        const nativeFs = packageFs(entry, {
          acpVersion: "2.0.0",
          target: `${platform}-${process.arch}`,
        });
        expect(resolveSupportedCodexAcpPackage(entry, platform, nativeFs)).toEqual({
          entryPath: entry,
          version: "2.0.0",
          kind: "bundle",
        });
      }
    );
    it.each([
      ["2.0.0", 1],
      ["2.0.0+build.1", 1],
      ["2.1.0-beta.1", 1],
      ["2.0.0", 2],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 retains native bundle identity %s revision %s for managed updates",
      (acpVersion, packagingRevision) => {
        const entry = "/bundle/codex-acp";
        expect(
          resolveSupportedCodexAcpPackage(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion,
              packagingRevision,
              target: `darwin-${process.arch}`,
            })
          )
        ).toEqual({
          entryPath: entry,
          version: `${acpVersion}-r${packagingRevision}`,
          kind: "bundle",
        });
      }
    );
    it.each([
      { acpVersion: "garbage" },
      { acpVersion: "0.0.45-beta.1" },
      { acpVersion: "0.0.44" },
      { packagingRevision: 0 },
      { packagingRevision: 1.5 },
      { packagingRevision: "1" },
      { target: "wrong-platform" },
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects malformed or unsupported native provenance %j",
      (override) => {
        const entry = "/bundle/codex-acp";
        expect(() =>
          resolveSupportedCodexAcpPackage(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion: "2.0.0",
              packagingRevision: 1,
              target: `darwin-${process.arch}`,
              ...override,
            })
          )
        ).toThrow("not supported");
      }
    );
  });
  describe("resolveSupportedCodexAcpEntry()", () => {
    it.each(["0.0.44", "0.0.45", "0.0.45-beta.1", "1.13.0", "2.0.0-beta.1"])(
      "rejects adapter %s below the supported minimum https://github.com/Brevilabs/obsidian-copilot-private/issues/618 https://github.com/logancyang/obsidian-copilot/issues/2967",
      (version) => {
        expect(() =>
          resolveSupportedCodexAcpEntry(
            UNIX_ENTRY,
            "darwin",
            packageFs(UNIX_ENTRY, metadata(version))
          )
        ).toThrow("not supported");
      }
    );

    it("https://github.com/logancyang/obsidian-copilot/issues/2967 accepts the minimum supported adapter", () => {
      const packageFileSystem = packageFs(UNIX_ENTRY, metadata(CODEX_MIN_VERSION));

      expect(
        resolveSupportedCodexAcpEntry("/usr/local/bin/codex-acp", "darwin", packageFileSystem)
      ).toBe(UNIX_ENTRY);
      expect(packageFileSystem.readFileSync).toHaveBeenCalledWith(
        "/npm/lib/node_modules/@agentclientprotocol/codex-acp/package.json",
        "utf8"
      );
    });

    it("resolves the current package layout with Windows path rules", () => {
      const entry = "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js";
      const packageFileSystem = packageFs(entry, metadata("2.0.0"));

      expect(resolveSupportedCodexAcpEntry(entry, "win32", packageFileSystem)).toBe(entry);
      expect(packageFileSystem.readFileSync).toHaveBeenCalledWith(
        "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\package.json",
        "utf8"
      );
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects the separate Zed adapter", () => {
      const packageFileSystem = packageFs(
        "/npm/lib/node_modules/@zed-industries/codex-acp/bin/codex-acp",
        { name: "@zed-industries/codex-acp", version: "0.16.0" }
      );

      expect(() =>
        resolveSupportedCodexAcpEntry("/usr/local/bin/codex-acp", "darwin", packageFileSystem)
      ).toThrow("not supported");
    });

    it.each(["2.1.0-beta.1", "2.0.0+build.1"])(
      "https://github.com/logancyang/obsidian-copilot/issues/2967 accepts supported versions with a semantic-version suffix: %s",
      (version) => {
        expect(
          resolveSupportedCodexAcpEntry(
            "/usr/local/bin/codex-acp",
            "darwin",
            packageFs(UNIX_ENTRY, metadata(version))
          )
        ).toBe(UNIX_ENTRY);
      }
    );

    it.each([
      ["wrong package", { ...metadata("2.0.0"), name: "other" }],
      ["wrong entry", { ...metadata("2.0.0"), bin: { "codex-acp": "bin/index.js" } }],
      ["malformed version", metadata("1.7")],
      ["malformed metadata", []],
    ])("rejects %s metadata", (_label, packageMetadata) => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, packageMetadata)
        )
      ).toThrow("not supported");
    });
  });

  describe("isSupportedCodexAcpPath()", () => {
    afterEach(() => {
      for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an empty path", () => {
      expect(isSupportedCodexAcpPath(undefined)).toBe(false);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 accepts a supported adapter path", () => {
      expect(isSupportedCodexAcpPath(installedAdapterPath(metadata("2.0.0")))).toBe(true);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an unsupported adapter path", () => {
      expect(
        isSupportedCodexAcpPath(installedAdapterPath({ ...metadata("2.0.0"), name: "other" }))
      ).toBe(false);
    });
  });

  describe("bundledCodexRuntimePath()", () => {
    it(`locates the native Codex shipped beside a bundled adapter: ${DIRECT_RUNTIME_ISSUE}`, () => {
      expect(
        bundledCodexRuntimePath("/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-acp", "darwin")
      ).toBe("/Users/Jane Doe/.obsidian-copilot/codex/2.0.1/codex-runtime/bin/codex");
      expect(
        bundledCodexRuntimePath(
          "C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-acp.exe",
          "win32"
        )
      ).toBe("C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.0.1\\codex-runtime\\bin\\codex.exe");
    });
  });
  describe("resolveCodexCommand()", () => {
    it.each([
      [
        "darwin",
        "/Users/Jane Doe/codex/codex-acp",
        "/Users/Jane Doe/codex/codex-runtime/bin/codex",
      ],
      [
        "win32",
        "C:\\Users\\Jane Doe\\codex\\codex-acp.exe",
        "C:\\Users\\Jane Doe\\codex\\codex-runtime\\bin\\codex.exe",
      ],
    ] as const)(
      `runs a %s bundle's own Codex even when CODEX_PATH is set: ${DIRECT_RUNTIME_ISSUE}`,
      (platform, entry, runtime) => {
        const bundleFs = packageFs(entry, {
          acpVersion: CODEX_MIN_VERSION,
          target: `${platform}-${process.arch}`,
        });
        expect(
          resolveCodexCommand(entry, { CODEX_PATH: "/global/codex" }, platform, bundleFs)
        ).toBe(runtime);
      }
    );
    it(`runs the Codex an npm adapter is pointed at through CODEX_PATH: ${DIRECT_RUNTIME_ISSUE}`, () => {
      expect(
        resolveCodexCommand(
          "/usr/local/bin/codex-acp",
          { CODEX_PATH: "/Users/Jane Doe/bin/codex" },
          "darwin",
          packageFs(UNIX_ENTRY, metadata(CODEX_MIN_VERSION))
        )
      ).toBe("/Users/Jane Doe/bin/codex");
    });
    it(`runs an npm adapter's own @openai/codex launcher when CODEX_PATH is unset: ${DIRECT_RUNTIME_ISSUE}`, () => {
      const npmFs = packageFs(UNIX_ENTRY, metadata(CODEX_MIN_VERSION));
      expect(resolveCodexCommand("/usr/local/bin/codex-acp", {}, "darwin", npmFs)).toBe(
        NPM_CODEX_LAUNCHER
      );
      expect(npmFs.resolveFrom).toHaveBeenCalledWith(UNIX_ENTRY, "@openai/codex/bin/codex.js");
    });
    it("rejects an adapter below the supported minimum", () => {
      expect(() =>
        resolveCodexCommand(UNIX_ENTRY, {}, "darwin", packageFs(UNIX_ENTRY, metadata("1.13.0")))
      ).toThrow("not supported");
    });
  });
  describe("buildCodexAcpInvocation()", () => {
    it.each(["darwin", "linux", "win32"] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 launches native bundles directly on %s",
      (platform) => {
        const entry = platform === "win32" ? "C:\\bundle\\codex-acp.exe" : "/bundle/codex-acp";
        expect(buildCodexAcpInvocation(entry, ["cli", "login"], {}, platform)).toEqual({
          command: entry,
          args: ["cli", "login"],
          env: {},
        });
      }
    );
    it("runs the validated package entry directly on Unix", () => {
      expect(buildCodexAcpInvocation(UNIX_ENTRY, [], { PATH: "/usr/bin" }, "darwin")).toEqual({
        command: UNIX_ENTRY,
        args: [],
        env: { PATH: "/usr/bin" },
      });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 uses the installed Node runtime for the Windows package entry", () => {
      const entry = "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js";
      expect(
        buildCodexAcpInvocation(
          entry,
          ["--flag"],
          { PATH: "C:\\Program Files\\nodejs" },
          "win32",
          "C:\\Program Files\\nodejs\\node.exe"
        )
      ).toEqual({
        command: "C:\\Program Files\\nodejs\\node.exe",
        args: [entry, "--flag"],
        env: { PATH: "C:\\Program Files\\nodejs" },
      });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 fails with recovery guidance when Windows cannot find Node.js", () => {
      expect(() => buildCodexAcpInvocation("C:\\npm\\dist\\index.js", [], {}, "win32")).toThrow(
        "Node.js was not found"
      );
    });
  });
});
