import {
  buildCodexAcpInvocation,
  CODEX_ACP_MIN_VERSION,
  resolveSupportedCodexAcpEntry,
  type CodexAcpPackageFs,
} from "./codexVersion";

const UNIX_ENTRY = "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js";

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

    it("rejects prerelease versions below the stable support contract", () => {
      expect(() =>
        resolveSupportedCodexAcpEntry(
          "/usr/local/bin/codex-acp",
          "darwin",
          packageFs(UNIX_ENTRY, metadata("0.0.38-beta.1"))
        )
      ).toThrow("not supported");
    });

    it.each([
      ["wrong package", { ...metadata("1.7.0"), name: "other" }],
      ["wrong entry", { ...metadata("1.7.0"), bin: { "codex-acp": "bin/index.js" } }],
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

  describe("buildCodexAcpInvocation()", () => {
    it("runs the validated package entry through Obsidian's Node runtime", () => {
      expect(buildCodexAcpInvocation(UNIX_ENTRY, [], { PATH: "/usr/bin" })).toEqual({
        command: process.execPath,
        args: [UNIX_ENTRY],
        env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
      });
    });
  });
});
