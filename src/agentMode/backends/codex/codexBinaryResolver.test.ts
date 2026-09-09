import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { buildCodexAcpInvocation, resolveSupportedCodexAcpPackage } from "./codexVersion";

import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return {
    existsSync: (p: string): boolean => existing.has(p),
    readFileSync: (): string => "",
    readdirSync: (): string[] => [],
  };
}

describe("codexBinaryResolver", () => {
  describe("resolveCodexAcpBinary()", () => {
    it("finds the current adapter's Windows npm entry point", () => {
      const expected = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "node_modules",
        "@agentclientprotocol",
        "codex-acp",
        "dist",
        "index.js"
      );

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2916 does not select the legacy Zed package", () => {
      const legacy = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "node_modules",
        "@zed-industries",
        "codex-acp",
        "node_modules",
        "@zed-industries",
        "codex-acp-win32-x64",
        "bin",
        "codex-acp.exe"
      );

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
          fs: fsWith([
            path.win32.join("C:\\Users\\me", "AppData", "Roaming", "npm", "codex-acp.cmd"),
            legacy,
          ]),
        })
      ).toBeNull();
    });

    it("skips an existing candidate that fails the package support contract", () => {
      const legacy = "/Users/me/.local/bin/codex-acp";
      const current = "/usr/local/bin/codex-acp";

      expect(
        resolveCodexAcpBinary(
          {
            homeDir: "/Users/me",
            platform: "darwin",
            env: {},
            fs: fsWith([legacy, current]),
          },
          (candidate) => candidate !== legacy
        )
      ).toBe(current);
    });

    it.each([
      ["PATH", "D:\\Program_Files\\nodejs\\node-v25.9.0-win-x64", false],
      ["Path", "D:\\custom npm", false],
      ["PATH", "D:\\Q3 R&D notes\\a^b\\100%_done\\it's fine", true],
    ] as const)(
      "finds a package known only through %s at %s, including quoted prefixes — https://github.com/logancyang/obsidian-copilot/issues/2967",
      (key, prefix, quoted) => {
        const entry = path.win32.join(
          prefix,
          "node_modules",
          "@agentclientprotocol",
          "codex-acp",
          "dist",
          "index.js"
        );
        expect(
          resolveCodexAcpBinary({
            homeDir: "C:\\Users\\me",
            platform: "win32",
            env: { [key]: `C:\\Windows\\System32;${quoted ? `  "${prefix}"  ` : prefix}` },
            fs: fsWith([entry]),
          })
        ).toBe(entry);
      }
    );

    it("keeps known npm locations ahead of inherited PATH — https://github.com/logancyang/obsidian-copilot/issues/2967", () => {
      const known = "C:\\known-npm";
      const inherited = "D:\\custom-npm";
      const entries = [known, inherited].map((prefix) =>
        path.win32.join(
          prefix,
          "node_modules",
          "@agentclientprotocol",
          "codex-acp",
          "dist",
          "index.js"
        )
      );
      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { npm_config_prefix: known, PATH: inherited },
          fs: fsWith(entries),
        })
      ).toBe(entries[0]);
    });

    it("skips a missing or unsupported PATH package before selecting a supported one — https://github.com/logancyang/obsidian-copilot/issues/2967", () => {
      const prefixes = ["D:\\missing", "D:\\wrong-package", "D:\\supported"];
      const entries = prefixes.map((prefix) =>
        path.win32.join(
          prefix,
          "node_modules",
          "@agentclientprotocol",
          "codex-acp",
          "dist",
          "index.js"
        )
      );
      const packageFs = {
        realpathSync: (candidate: string) => candidate,
        readFileSync: (metadataPath: string) =>
          JSON.stringify({
            name: metadataPath.startsWith(prefixes[1])
              ? "@zed-industries/codex-acp"
              : "@agentclientprotocol/codex-acp",
            version: "1.10.0",
            bin: { "codex-acp": "dist/index.js" },
          }),
      };
      const accepts = jest.fn((candidate: string) => {
        try {
          resolveSupportedCodexAcpPackage(candidate, "win32", packageFs);
          return true;
        } catch {
          return false;
        }
      });
      expect(
        resolveCodexAcpBinary(
          {
            homeDir: "C:\\Users\\me",
            platform: "win32",
            env: { PATH: prefixes.join(";") },
            fs: fsWith(entries.slice(1)),
          },
          accepts
        )
      ).toBe(entries[2]);
      expect(accepts.mock.calls).toEqual([[entries[1]], [entries[2]]]);
    });

    // This exercises actual Windows filesystem and process semantics; portable path cases above always run.
    const itOnWindows = process.platform === "win32" ? it : it.skip;
    itOnWindows(
      "discovers a real Windows npm-layout package and preserves its Node argv and stdio — https://github.com/logancyang/obsidian-copilot/issues/2967",
      () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-path-"));
        try {
          const prefix = path.join(root, "Q3 R&D notes", "a^b", "100%_done", "it's fine");
          const packageRoot = path.join(
            prefix,
            "node_modules",
            "@agentclientprotocol",
            "codex-acp"
          );
          const entry = path.join(packageRoot, "dist", "index.js");
          fs.mkdirSync(path.dirname(entry), { recursive: true });
          fs.writeFileSync(
            path.join(packageRoot, "package.json"),
            JSON.stringify({
              name: "@agentclientprotocol/codex-acp",
              version: "1.10.0",
              bin: { "codex-acp": "dist/index.js" },
            })
          );
          fs.writeFileSync(
            entry,
            `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input })));`
          );
          const found = resolveCodexAcpBinary(
            {
              homeDir: root,
              platform: process.platform,
              env: { PATH: `"${prefix}"` },
              fs,
            },
            (candidate) => {
              resolveSupportedCodexAcpPackage(candidate);
              return true;
            }
          );
          expect(found).toBe(entry);
          const args = [
            "--version",
            "value with spaces",
            "Q3 R&D notes",
            "100%_done.md",
            "a^b",
            'say "hi"',
          ];
          const invocation = buildCodexAcpInvocation(
            found!,
            args,
            process.env,
            process.platform,
            process.execPath
          );
          const input = "stdio round trip\n";
          const output = execFileSync(invocation.command, invocation.args, {
            env: invocation.env,
            input,
            encoding: "utf8",
            windowsHide: true,
            timeout: 10_000,
          });
          expect(JSON.parse(output)).toEqual({ args, input });
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    );
  });

  describe("codexAcpSearchDirs()", () => {
    it("reports the current Windows package directory in searched dirs", () => {
      const dirs = codexAcpSearchDirs({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
        fs: fsWith([]),
      });

      expect(dirs).toContain(
        path.win32.join(
          "C:\\Users\\me",
          "AppData",
          "Roaming",
          "npm",
          "node_modules",
          "@agentclientprotocol",
          "codex-acp",
          "dist"
        )
      );
    });

    it("lists the absolute PATH package directory without treating empty or relative entries as prefixes — https://github.com/logancyang/obsidian-copilot/issues/2967", () => {
      const prefix = "D:\\custom npm";
      const dirs = codexAcpSearchDirs({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { PATH: `;;.;relative;C:drive-relative;  "${prefix}"  ;` },
        fs: fsWith([]),
      });
      expect(dirs).toContain(
        path.win32.join(prefix, "node_modules", "@agentclientprotocol", "codex-acp", "dist")
      );
      expect(dirs.every((directory) => path.win32.isAbsolute(directory))).toBe(true);
      expect(dirs.some((directory) => directory.includes("relative"))).toBe(false);
    });
  });
});
