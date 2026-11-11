import * as fs from "node:fs";
import * as os from "os";
import * as path from "node:path";
import type CopilotPlugin from "@/main";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { codexApprovedRules, codexHomeDir } from "./codexApprovedRules";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/868";
const plugin = {} as CopilotPlugin;
const erasedLine = (line: string) => `#${line.slice(1)}\n`;

const HAND_WRITTEN = [
  "# Keep git status quiet; written by hand.",
  "prefix_rule(",
  '    pattern=["git", "status"],',
  '    decision="allow",',
  ")",
  "prefix_rule(pattern=['npm', 'test'], decision=\"allow\")",
  'prefix_rule(pattern=["rm"], decision="forbidden")',
  'network_rule(host="evil.example", protocol="https", decision="deny")',
  'prefix_rule(pattern=["ls"], decision="allow")\r',
].join("\n");
const GH_API = 'prefix_rule(pattern=["gh", "api"], decision="allow")';
const COMMIT = 'prefix_rule(pattern=["git", "commit", "-m", "it\'s done"], decision="allow")';
const GITHUB_HOST =
  'network_rule(host="api.github.com", protocol="https", decision="allow", justification="Allow https_connect access to api.github.com")';

// Concurrent checks record to one path; CopyFile locks its destination on Windows, so the fake writes it instead.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/900
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const env = process.env;
fs.writeFileSync(env.FAKE_CODEX_LOG, [...args, "CODEX_HOME=" + env.CODEX_HOME, "PATH=" + env.PATH, ""].join("\\n"));
fs.writeFileSync(env.FAKE_CODEX_LOG + ".checked", fs.readFileSync(args[3]));
if (env.FAKE_CODEX_SAVES) {
  fs.appendFileSync(path.join(env.CODEX_HOME, "rules", "default.rules"), env.FAKE_CODEX_SAVES + "\\n");
}
if (env.FAKE_CODEX_FAIL || fs.existsSync(env.FAKE_CODEX_LOG + ".fail")) {
  process.stderr.write("starlark error: Parse error: unexpected new line --> " + args[3] + ":2:1\\n");
  process.exit(1);
}
process.stdout.write('{"matchedRules":[]}\\n');
`;

describe("codexApprovedRules", () => {
  let codexHome: string;
  let inheritedHome: string;
  let userHome: string;
  let savedInheritedHome: string | undefined;
  let savedHome: string | undefined;
  let install: string;
  let checkLog: string;
  const rulesFile = () => path.join(codexHome, "rules", "default.rules");
  const writeRules = (text: string) => {
    fs.mkdirSync(path.dirname(rulesFile()), { recursive: true });
    fs.writeFileSync(rulesFile(), text);
  };
  const readRules = () => fs.readFileSync(rulesFile(), "utf8");
  const configure = (envOverrides: Record<string, string> = { CODEX_HOME: codexHome }) =>
    setSettings({
      agentMode: {
        ...getSettings().agentMode,
        backends: {
          codex: {
            binaryPath: path.join(
              install,
              "node_modules",
              "@agentclientprotocol",
              "codex-acp",
              "dist",
              "index.js"
            ),
            binarySource: "custom",
            envOverrides: { FAKE_CODEX_LOG: checkLog, ...envOverrides },
          },
        },
      },
    });

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    inheritedHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-inherited-home-"));
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-user-home-"));
    jest.mocked(os.homedir).mockReturnValue(userHome);
    savedHome = process.env.HOME;
    process.env.HOME = userHome;
    savedInheritedHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = inheritedHome;
    install = fs.mkdtempSync(path.join(os.tmpdir(), "codex-install-"));
    checkLog = path.join(install, "check.log");
    const adapter = path.join(install, "node_modules", "@agentclientprotocol", "codex-acp");
    fs.mkdirSync(path.join(adapter, "dist"), { recursive: true });
    fs.writeFileSync(path.join(adapter, "dist", "index.js"), "");
    fs.writeFileSync(
      path.join(adapter, "package.json"),
      JSON.stringify({
        name: "@agentclientprotocol/codex-acp",
        version: "2.2.2",
        bin: { "codex-acp": "dist/index.js" },
      })
    );
    const codex = path.join(adapter, "node_modules", "@openai", "codex", "bin", "codex.js");
    fs.mkdirSync(path.dirname(codex), { recursive: true });
    fs.writeFileSync(codex, FAKE_CODEX, { mode: 0o755 });
    resetSettings();
    configure();
  });
  afterEach(() => {
    resetSettings();
    if (savedInheritedHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedInheritedHome;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(inheritedHome, { recursive: true, force: true });
    fs.rmSync(userHome, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  });

  describe("list()", () => {
    it("lists each command and host Codex was told to always allow, in readable form, saved in rules/default.rules of the Codex home", async () => {
      writeRules(`${GH_API}\n${HAND_WRITTEN}\n${COMMIT}\n${GITHUB_HOST}\n`);

      const rules = await codexApprovedRules.list(plugin);

      expect(rules).toEqual([
        { id: GH_API, allows: "gh api", appliesTo: { kind: "file", path: rulesFile() } },
        {
          id: COMMIT,
          allows: "git commit -m 'it'\\''s done'",
          appliesTo: { kind: "file", path: rulesFile() },
        },
        {
          id: GITHUB_HOST,
          allows: "Network access to api.github.com (https)",
          appliesTo: { kind: "file", path: rulesFile() },
        },
      ]);
    });

    it(`reads the CODEX_HOME codex-acp gets: the user's Codex env override, else Obsidian's own, and Codex's default home when the override is empty: ${ISSUE}`, async () => {
      const homes = [codexHome, inheritedHome, path.join(userHome, ".codex")];
      for (const home of homes) {
        fs.mkdirSync(path.join(home, "rules"), { recursive: true });
        fs.writeFileSync(path.join(home, "rules", "default.rules"), `${GH_API}\n`);
      }
      const listedFile = async () => (await codexApprovedRules.list(plugin))[0].appliesTo;

      const fromOverride = await listedFile();
      configure({});
      const fromObsidian = await listedFile();
      configure({ CODEX_HOME: "" });
      const fromEmptyOverride = await listedFile();

      expect([fromOverride, fromObsidian, fromEmptyOverride]).toEqual(
        homes.map((home) => ({ kind: "file", path: path.join(home, "rules", "default.rules") }))
      );
    });

    it(`reads <HOME>/.codex when the user's Codex env overrides HOME without a CODEX_HOME, except on Windows where Codex ignores HOME: ${ISSUE}`, async () => {
      const overriddenHome = path.join(codexHome, "home");
      for (const home of [path.join(overriddenHome, ".codex"), path.join(userHome, ".codex")]) {
        fs.mkdirSync(path.join(home, "rules"), { recursive: true });
        fs.writeFileSync(path.join(home, "rules", "default.rules"), `${GH_API}\n`);
      }
      delete process.env.CODEX_HOME;
      configure({ HOME: overriddenHome });
      const listedFileOn = async (platform: NodeJS.Platform) => {
        const host = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
        Object.defineProperty(process, "platform", { value: platform });
        try {
          return (await codexApprovedRules.list(plugin))[0].appliesTo;
        } finally {
          Object.defineProperty(process, "platform", host);
        }
      };

      const onMacOrLinux = await listedFileOn("linux");
      const onWindows = await listedFileOn("win32");

      expect([onMacOrLinux, onWindows]).toEqual([
        { kind: "file", path: path.join(overriddenHome, ".codex", "rules", "default.rules") },
        { kind: "file", path: path.join(userHome, ".codex", "rules", "default.rules") },
      ]);
    });

    it(`gives no rules when the Codex home has no rules file yet: ${ISSUE}`, async () => {
      await expect(codexApprovedRules.list(plugin)).resolves.toEqual([]);
    });

    it(`rejects when the rules file can't be read, so the page shows it can't read the rules: ${ISSUE}`, async () => {
      fs.mkdirSync(rulesFile(), { recursive: true });

      await expect(codexApprovedRules.list(plugin)).rejects.toThrow("EISDIR");
    });
  });

  describe("remove()", () => {
    it("comments only that rule, keeps every other byte, and has the configured Codex check the edited text first", async () => {
      writeRules(`${HAND_WRITTEN}\n${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n${erasedLine(GH_API)}${COMMIT}\n`);
      expect(fs.readFileSync(checkLog, "utf8").split("\n").slice(0, 3)).toEqual([
        "execpolicy",
        "check",
        "--rules",
      ]);
      expect(fs.readFileSync(`${checkLog}.checked`, "utf8")).toBe(
        `${HAND_WRITTEN}\n${erasedLine(GH_API)}${COMMIT}\n`
      );
    });

    it(`comments every duplicate grant at its UTF-8 byte offset while preserving surrounding rules and comments: ${ISSUE}`, async () => {
      const grant = 'prefix_rule(pattern=["echo", "résumé🧪"], decision="allow")';
      const before = `# Café 🧪\n${grant}\n${GH_API}\n${grant}\n`;
      writeRules(before);
      const [rule] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, rule);

      expect(readRules()).toBe(`# Café 🧪\n${erasedLine(grant)}${GH_API}\n${erasedLine(grant)}`);
      expect(Buffer.byteLength(readRules())).toBe(Buffer.byteLength(before));
      expect((await codexApprovedRules.list(plugin)).map((listed) => listed.id)).toEqual([GH_API]);
    });

    it(`restores only the removed grant and keeps approvals appended after removal: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const removal = await codexApprovedRules.remove(plugin, rule);
      expect(removal).toBeDefined();
      if (!removal) throw new Error("Expected an undoable removal");
      fs.appendFileSync(rulesFile(), `${GITHUB_HOST}\n`);

      await removal.undo();

      expect(readRules()).toBe(`${GH_API}\n${COMMIT}\n${GITHUB_HOST}\n`);
      await removal.undo();
      expect(readRules()).toBe(`${GH_API}\n${COMMIT}\n${GITHUB_HOST}\n`);
    });

    it(`refuses Undo if the disabled rule was edited, keeping every newer byte unchanged: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const removal = await codexApprovedRules.remove(plugin, rule);
      if (!removal) throw new Error("Expected an undoable removal");
      writeRules(`# changed by user\n${COMMIT}\n`);
      const edited = readRules();

      await expect(removal.undo()).rejects.toThrow("changed");

      expect(readRules()).toBe(edited);
    });

    it(`leaves complete commented or active rules if writing another duplicate fails, never a half-erased rule: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${GH_API}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const open = fs.promises.open.bind(fs.promises);
      const opening = jest
        .spyOn(fs.promises, "open")
        .mockImplementationOnce(async (file, flags, mode) => {
          const handle = await open(file, flags, mode);
          const write = handle.write.bind(handle);
          let writes = 0;
          jest.spyOn(handle, "write").mockImplementation((async (
            buffer: Uint8Array,
            offset: number,
            _length: number,
            position: number
          ) => {
            if (writes++ > 0) throw new Error("write interrupted");
            return write(buffer, offset, 1, position);
          }) as typeof handle.write);
          return handle;
        });
      try {
        await expect(codexApprovedRules.remove(plugin, rule)).rejects.toThrow("write interrupted");
      } finally {
        opening.mockRestore();
      }

      expect(readRules()).toBe(`#${GH_API.slice(1)}\n${GH_API}\n`);
    });

    it(`refuses to change a rule replaced after the last read and before the file is opened for writing: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const open = fs.promises.open.bind(fs.promises);
      const opening = jest
        .spyOn(fs.promises, "open")
        .mockImplementationOnce(async (file, flags, mode) => {
          writeRules(`${COMMIT}\n`);
          return open(file, flags, mode);
        });
      try {
        await expect(codexApprovedRules.remove(plugin, rule)).rejects.toThrow("rules file changed");
      } finally {
        opening.mockRestore();
      }
      expect(readRules()).toBe(`${COMMIT}\n`);
    });

    it(`reports a marker write that made no progress instead of reporting a successful removal: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const open = fs.promises.open.bind(fs.promises);
      const opening = jest
        .spyOn(fs.promises, "open")
        .mockImplementationOnce(async (file, flags, mode) => {
          const handle = await open(file, flags, mode);
          jest.spyOn(handle, "write").mockImplementation((async (buffer: Uint8Array) => ({
            bytesWritten: 0,
            buffer,
          })) as typeof handle.write);
          return handle;
        });
      try {
        await expect(codexApprovedRules.remove(plugin, rule)).rejects.toThrow(
          "marker could not be written"
        );
      } finally {
        opening.mockRestore();
      }
      expect(readRules()).toBe(`${GH_API}\n`);
    });

    it(`keeps the rule disabled and preserves new grants when Codex rejects the Undo candidate: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [rule] = await codexApprovedRules.list(plugin);
      const removal = await codexApprovedRules.remove(plugin, rule);
      if (!removal) throw new Error("Expected an undoable removal");
      fs.writeFileSync(`${checkLog}.fail`, "");
      fs.appendFileSync(rulesFile(), `${GITHUB_HOST}\n`);

      await expect(removal.undo()).rejects.toThrow("couldn't validate the changed rules");

      expect(readRules()).toBe(`${erasedLine(GH_API)}${COMMIT}\n${GITHUB_HOST}\n`);
    });

    it(`keeps a grant Codex saves while the check runs: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      configure({ CODEX_HOME: codexHome, FAKE_CODEX_SAVES: GITHUB_HOST });

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${erasedLine(GH_API)}${COMMIT}\n${GITHUB_HOST}\n`);
    });

    it(`keeps a grant appended after the final read, without truncating or replacing the rules file: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      const readFile = fs.promises.readFile.bind(fs.promises);
      const inode = fs.statSync(rulesFile()).ino;
      const read = jest.spyOn(fs.promises, "readFile");
      read.mockImplementationOnce(readFile).mockImplementationOnce(async (file, options) => {
        const text = await readFile(file, options);
        fs.appendFileSync(rulesFile(), `${GITHUB_HOST}\n`);
        return text;
      });
      try {
        await codexApprovedRules.remove(plugin, ghApi);
      } finally {
        read.mockRestore();
      }

      expect(readRules()).toContain(`${COMMIT}\n${GITHUB_HOST}\n`);
      expect(fs.statSync(rulesFile()).ino).toBe(inode);
      expect((await codexApprovedRules.list(plugin)).map((rule) => rule.id)).toEqual([
        COMMIT,
        GITHUB_HOST,
      ]);
    });

    it(`runs the check with the environment codex-acp gets, including its PATH and the user's CODEX_HOME: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      const codex = getSettings().agentMode.backends?.codex;
      const adapterEnv = buildSimpleSpawnDescriptor(codex?.binaryPath, "", codex?.envOverrides).env;

      await codexApprovedRules.remove(plugin, ghApi);

      expect(fs.readFileSync(checkLog, "utf8").split("\n").slice(5, 7)).toEqual([
        `CODEX_HOME=${codexHome}`,
        `PATH=${adapterEnv.PATH}`,
      ]);
    });

    it(`comments a last line without changing its missing line break: ${ISSUE}`, async () => {
      writeRules(`${HAND_WRITTEN}\n${GITHUB_HOST}`);
      const [githubHost] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, githubHost);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n#${GITHUB_HOST.slice(1)}`);
    });

    it(`leaves the file as it was, including a grant Codex saves meanwhile, and rejects with Codex's error when Codex can't read the edited text: ${ISSUE}`, async () => {
      writeRules(`${HAND_WRITTEN}\n${GH_API}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      configure({ CODEX_HOME: codexHome, FAKE_CODEX_FAIL: "1", FAKE_CODEX_SAVES: GITHUB_HOST });

      await expect(codexApprovedRules.remove(plugin, ghApi)).rejects.toThrow(
        `Codex couldn't validate the changed rules, so the file was left as it was. starlark error: Parse error: unexpected new line --> ${rulesFile()}:2:1`
      );
      expect(readRules()).toBe(`${HAND_WRITTEN}\n${GH_API}\n${GITHUB_HOST}\n`);
    });

    it(`leaves the file untouched when it no longer holds the rule: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      writeRules(`${HAND_WRITTEN}\n`);
      const modified = fs.statSync(rulesFile()).mtimeMs;

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n`);
      expect(fs.statSync(rulesFile()).mtimeMs).toBe(modified);
      expect(fs.existsSync(checkLog)).toBe(false);
    });

    it(`rejects without touching the file when Codex isn't set up to check it: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      setSettings({
        agentMode: {
          ...getSettings().agentMode,
          backends: { codex: { envOverrides: { CODEX_HOME: codexHome } } },
        },
      });

      await expect(codexApprovedRules.remove(plugin, ghApi)).rejects.toThrow("Install Codex");
      expect(readRules()).toBe(`${GH_API}\n`);
    });

    it(`comments both rules when two removals run at once, since each changes only its own byte: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n${GITHUB_HOST}\n`);
      const [ghApi, commit] = await codexApprovedRules.list(plugin);

      await Promise.all([
        codexApprovedRules.remove(plugin, ghApi),
        codexApprovedRules.remove(plugin, commit),
      ]);

      expect(readRules()).toBe(`${erasedLine(GH_API)}${erasedLine(COMMIT)}${GITHUB_HOST}\n`);
    });
  });

  describe("codexHomeDir()", () => {
    it("uses CODEX_HOME when it is set", () => {
      expect(codexHomeDir({ CODEX_HOME: "/data/codex", HOME: "/home/me" })).toBe("/data/codex");
    });

    it(`falls back to .codex under the HOME Codex runs with ${ISSUE}`, () => {
      expect(codexHomeDir({ HOME: "/home/me" })).toBe(path.join("/home/me", ".codex"));
    });
  });
});
