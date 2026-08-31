import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildCodexAcpInvocation,
  CODEX_ACP_MIN_VERSION,
  isSupportedCodexAcpPath,
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
  describe("resolveSupportedCodexAcpEntry()", () => {
    it("accepts a launcher that resolves to the earliest published current adapter", () => {
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
      const packageFileSystem = packageFs(entry, metadata("1.7.0"));

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

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 asks users to upgrade an older current adapter", () => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata("0.0.37"))
        )
      ).toThrow("0.0.37 is not supported");
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects a prerelease at the stable minimum", () => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata("0.0.38-beta.1"))
        )
      ).toThrow("not supported");
    });

    it.each(["1.8.0-beta.1", "1.7.0+build.1", "0.0.38+build.1"])(
      "https://github.com/logancyang/obsidian-copilot/issues/2916 accepts supported versions with a semantic-version suffix: %s",
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
      expect(isSupportedCodexAcpPath(installedAdapterPath(metadata("1.7.0")))).toBe(true);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 rejects an unsupported adapter path", () => {
      expect(
        isSupportedCodexAcpPath(installedAdapterPath({ ...metadata("1.7.0"), name: "other" }))
      ).toBe(false);
    });
  });

  describe("buildCodexAcpInvocation()", () => {
    it("runs the validated package entry directly on Unix", () => {
      expect(buildCodexAcpInvocation(UNIX_ENTRY, [], { PATH: "/usr/bin" })).toEqual({
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
