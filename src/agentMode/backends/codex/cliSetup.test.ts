import { codexBinaryPathPlaceholder, codexSignInCommand } from "./cliSetup";
import type { CodexAcpPackageFs } from "./codexVersion";

const DIRECT_RUNTIME_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/686";
const NPM_ENTRY = "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js";
const NPM_LAUNCHER =
  "/npm/lib/node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex/bin/codex.js";

function packageFs(
  entryPath: string,
  metadata: object,
  launcher = NPM_LAUNCHER
): CodexAcpPackageFs {
  return {
    realpathSync: () => entryPath,
    readFileSync: () => JSON.stringify(metadata),
    resolveFrom: () => launcher,
  };
}

function npmFs(entryPath: string, launcher?: string): CodexAcpPackageFs {
  return packageFs(
    entryPath,
    {
      name: "@agentclientprotocol/codex-acp",
      version: "2.2.2",
      bin: { "codex-acp": "dist/index.js" },
    },
    launcher
  );
}

function bundleFs(entryPath: string, platform: NodeJS.Platform): CodexAcpPackageFs {
  return packageFs(entryPath, { acpVersion: "2.2.2", target: `${platform}-${process.arch}` });
}

describe("cliSetup", () => {
  describe("codexSignInCommand()", () => {
    it(`signs an npm adapter in through its own Codex launcher with the profile and without API keys: ${DIRECT_RUNTIME_ISSUE}`, () => {
      expect(
        codexSignInCommand(
          "/usr/local/bin/codex-acp",
          { CODEX_HOME: "/profile", OPENAI_API_KEY: "secret" },
          "darwin",
          npmFs(NPM_ENTRY)
        )
      ).toBe(`CODEX_HOME=/profile '${NPM_LAUNCHER}' login`);
    });
    it(`signs an npm adapter in through the Codex its CODEX_PATH override names: ${DIRECT_RUNTIME_ISSUE}`, () => {
      expect(
        codexSignInCommand(
          "/usr/local/bin/codex-acp",
          { CODEX_HOME: "/profile", CODEX_PATH: "/Users/Jane Doe/bin/codex" },
          "darwin",
          npmFs(NPM_ENTRY)
        )
      ).toBe("CODEX_HOME=/profile '/Users/Jane Doe/bin/codex' login");
    });
    it(`runs a Windows npm adapter's Codex launcher through Node: ${DIRECT_RUNTIME_ISSUE}`, () => {
      const entry = "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js";
      const launcher =
        "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\node_modules\\@openai\\codex\\bin\\codex.js";
      expect(
        codexSignInCommand(entry, { CODEX_HOME: "/profile" }, "win32", npmFs(entry, launcher))
      ).toBe(`$env:CODEX_HOME = '/profile'; node '${launcher}' login`);
    });
    it.each([
      [
        "darwin",
        "/Users/Jane Doe/.obsidian-copilot/codex/2.2.2/codex-acp",
        "CODEX_HOME=/profile '/Users/Jane Doe/.obsidian-copilot/codex/2.2.2/codex-runtime/bin/codex' login",
      ],
      [
        "win32",
        "C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.2.2\\codex-acp.exe",
        "$env:CODEX_HOME = '/profile'; & 'C:\\Users\\Jane Doe\\.obsidian-copilot\\codex\\2.2.2\\codex-runtime\\bin\\codex.exe' login",
      ],
    ] as const)(
      `signs a %s bundle in through its own Codex with a quoted path: ${DIRECT_RUNTIME_ISSUE}`,
      (platform, entry, command) => {
        expect(
          codexSignInCommand(
            entry,
            { CODEX_HOME: "/profile", CODEX_PATH: "/global/codex" },
            platform,
            bundleFs(entry, platform)
          )
        ).toBe(command);
      }
    );
    it(`omits terminal sign-in when no supported adapter is selected: ${DIRECT_RUNTIME_ISSUE}`, () => {
      const missing: CodexAcpPackageFs = {
        realpathSync: () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        readFileSync: () => "",
        resolveFrom: () => "",
      };
      expect(codexSignInCommand(undefined, undefined, "darwin", missing)).toBeNull();
      expect(codexSignInCommand("/gone/codex-acp", undefined, "darwin", missing)).toBeNull();
      expect(
        codexSignInCommand(
          "/old/codex-acp",
          undefined,
          "darwin",
          bundleFs("/old/codex-acp", "linux")
        )
      ).toBeNull();
    });
  });
  describe("codexBinaryPathPlaceholder()", () => {
    it("names the npm package entry point on Windows and the executable elsewhere", () => {
      expect(codexBinaryPathPlaceholder("win32")).toBe(
        "C:\\path\\to\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(codexBinaryPathPlaceholder("darwin")).toBe("/absolute/path/to/codex-acp");
    });
  });
});
