import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CODEX_ACP_PINNED_VERSION } from "./cliSetup";

import {
  buildCodexAcpInvocation,
  CODEX_ACP_MIN_VERSION,
  isCodexAcpPath,
  isSupportedCodexAcpPath,
  resolveCodexAcpPackage,
  resolveSupportedCodexAcpEntry,
  type CodexAcpPackageFs,
} from "./codexVersion";

const UNIX_ENTRY = "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js";
const tempDirs: string[] = [];

function packageFs(entryPath: string, packageMetadata: unknown): CodexAcpPackageFs {
  return {
    realpathSync: jest.fn().mockReturnValue(entryPath),
    readFileSync: jest.fn().mockReturnValue(JSON.stringify(packageMetadata)),
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
  describe("resolveCodexAcpPackage()", () => {
    it("returns the validated version of a user-owned npm package", () => {
      const packageFileSystem = packageFs(UNIX_ENTRY, metadata("1.10.0"));

      expect(
        resolveCodexAcpPackage("/usr/local/bin/codex-acp", "darwin", packageFileSystem)
      ).toEqual({ entryPath: UNIX_ENTRY, version: "1.10.0", acpVersion: "1.10.0" });
    });
    it.each(["darwin", "linux", "win32"] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 recognizes a native bundle on %s",
      (platform) => {
        const entry = platform === "win32" ? "C:\\bundle\\codex-acp.exe" : "/bundle/codex-acp";
        const nativeFs = packageFs(entry, {
          acpVersion: "1.10.0",
          target: `${platform}-${process.arch}`,
        });
        expect(resolveCodexAcpPackage(entry, platform, nativeFs)).toEqual({
          entryPath: entry,
          version: "1.10.0",
          acpVersion: "1.10.0",
        });
      }
    );
    it.each([
      ["1.9.0", 1],
      ["0.0.44", 1],
      ["0.0.45-beta.1", 1],
      ["0.0.45", 1],
      ["0.0.45+build.1", 1],
      ["0.0.46-beta.1", 1],
      ["1.10.0", 2],
    ])(
      "retains native bundle identity %s revision %s for managed updates (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (acpVersion, packagingRevision) => {
        const entry = "/bundle/codex-acp";
        expect(
          resolveCodexAcpPackage(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion,
              packagingRevision,
              target: `darwin-${process.arch}`,
            })
          )
        ).toEqual({ entryPath: entry, version: `${acpVersion}-r${packagingRevision}`, acpVersion });
      }
    );
    it.each([
      { acpVersion: "garbage" },
      { packagingRevision: 0 },
      { packagingRevision: 1.5 },
      { packagingRevision: "1" },
      { target: "wrong-platform" },
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects malformed or unsupported native provenance %j",
      (override) => {
        const entry = "/bundle/codex-acp";
        expect(() =>
          resolveCodexAcpPackage(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion: "1.10.0",
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
    it("rejects execution below the managed release floor (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(CODEX_ACP_MIN_VERSION).toBe(CODEX_ACP_PINNED_VERSION);
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata("1.10.0"))
        )
      ).toThrow("not supported");
    });
    it.each(["0.0.44", "0.0.45-beta.1", "1.10.0", `${CODEX_ACP_PINNED_VERSION}-beta.1`])(
      "rejects execution of recognized native adapter %s below the stable floor (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (acpVersion) => {
        const entry = "/bundle/codex-acp";
        expect(() =>
          resolveSupportedCodexAcpEntry(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion,
              target: `darwin-${process.arch}`,
            })
          )
        ).toThrow("not supported");
      }
    );
    it.each([CODEX_ACP_PINNED_VERSION, "1.13.0"])(
      "allows execution of recognized native adapter %s at or above the floor (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (acpVersion) => {
        const entry = "/bundle/codex-acp";
        expect(
          resolveSupportedCodexAcpEntry(
            entry,
            "darwin",
            packageFs(entry, {
              acpVersion,
              target: `darwin-${process.arch}`,
            })
          )
        ).toBe(entry);
      }
    );
    it("accepts the managed release floor (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      const packageFileSystem = packageFs(UNIX_ENTRY, metadata(CODEX_ACP_MIN_VERSION));

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
      const packageFileSystem = packageFs(entry, metadata(CODEX_ACP_PINNED_VERSION));

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

    it("https://github.com/logancyang/obsidian-copilot/issues/2967 rejects an adapter without bundled CLI authentication", () => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata("0.0.44"))
        )
      ).toThrow("v0.0.44 is not supported");
    });

    it("rejects a prerelease at the stable release floor (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata(`${CODEX_ACP_PINNED_VERSION}-beta.1`))
        )
      ).toThrow("not supported");
    });

    it.each(["1.13.0-beta.1", "1.13.0+build.1", `${CODEX_ACP_PINNED_VERSION}+build.1`])(
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
      ["wrong package", { ...metadata("1.7.0"), name: "other" }],
      ["wrong entry", { ...metadata("1.7.0"), bin: { "codex-acp": "bin/index.js" } }],
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

  describe("isCodexAcpPath()", () => {
    afterEach(() => {
      for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an empty path", () => {
      expect(isCodexAcpPath(undefined)).toBe(false);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 accepts a supported adapter path", () => {
      expect(isCodexAcpPath(installedAdapterPath(metadata(CODEX_ACP_PINNED_VERSION)))).toBe(true);
    });
    it("recognizes an old adapter so auto-detect can retain its path for upgrade guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(isCodexAcpPath(installedAdapterPath(metadata("0.0.44")))).toBe(true);
    });
    it("rejects missing paths and malformed package versions (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(isCodexAcpPath("/missing/codex-acp")).toBe(false);
      expect(isCodexAcpPath(installedAdapterPath(metadata("garbage")))).toBe(false);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an unsupported adapter path", () => {
      expect(isCodexAcpPath(installedAdapterPath({ ...metadata("1.7.0"), name: "other" }))).toBe(
        false
      );
    });
  });

  describe("isSupportedCodexAcpPath()", () => {
    afterEach(() => {
      for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("separates a runnable adapter from one that is merely genuine, so detection can rank candidates (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      const outdated = installedAdapterPath(metadata("0.0.44"));

      expect(isCodexAcpPath(outdated)).toBe(true);
      expect(isSupportedCodexAcpPath(outdated)).toBe(false);
      expect(isSupportedCodexAcpPath(installedAdapterPath(metadata(CODEX_ACP_MIN_VERSION)))).toBe(
        true
      );
    });

    it("rejects an empty path and an adapter that is not installed (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(isSupportedCodexAcpPath(undefined)).toBe(false);
      expect(isSupportedCodexAcpPath("/missing/codex-acp")).toBe(false);
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
