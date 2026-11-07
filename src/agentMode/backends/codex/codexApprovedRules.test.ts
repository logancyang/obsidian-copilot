import * as fs from "node:fs";
import * as os from "os";
import * as path from "node:path";
import type CopilotPlugin from "@/main";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { codexApprovedRules } from "./codexApprovedRules";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/868";
const plugin = {} as CopilotPlugin;

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

const FAKE_BUNDLED_CODEX_RUNTIME = `#!/bin/sh
printf '%s\\n' "$@" "CODEX_HOME=$CODEX_HOME" "PATH=$PATH" > "$FAKE_CODEX_LOG"
cp "$4" "$FAKE_CODEX_LOG.checked"
if [ -n "$FAKE_CODEX_SAVES" ]; then
  printf '%s\\n' "$FAKE_CODEX_SAVES" >> "$CODEX_HOME/rules/default.rules"
fi
if [ -n "$FAKE_CODEX_FAIL" ]; then
  echo "starlark error: Parse error: unexpected new line --> $4:2:1" >&2
  exit 1
fi
echo '{"matchedRules":[]}'
`;

describe("codexApprovedRules", () => {
  let codexHome: string;
  let inheritedHome: string;
  let userHome: string;
  let savedInheritedHome: string | undefined;
  let savedHome: string | undefined;
  let bundle: string;
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
            binaryPath: path.join(bundle, "codex-acp"),
            binarySource: "managed",
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
    bundle = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bundle-"));
    checkLog = path.join(bundle, "check.log");
    fs.writeFileSync(path.join(bundle, "codex-acp"), "", { mode: 0o755 });
    fs.writeFileSync(
      path.join(bundle, "provenance.json"),
      JSON.stringify({ acpVersion: "2.2.2", target: `${process.platform}-${process.arch}` })
    );
    fs.mkdirSync(path.join(bundle, "codex-runtime", "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(bundle, "codex-runtime", "bin", "codex"),
      FAKE_BUNDLED_CODEX_RUNTIME,
      {
        mode: 0o755,
      }
    );
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
    fs.rmSync(bundle, { recursive: true, force: true });
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
      const listedFile = async () => (await codexApprovedRules.list(plugin))[0].appliesTo;

      const onMacOrLinux = await listedFile();
      const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
      Object.defineProperty(process, "platform", { value: "win32" });
      const onWindows = await listedFile().finally(() =>
        Object.defineProperty(process, "platform", platform)
      );

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
    it("deletes only that rule's line, keeps every other byte, and has the configured Codex check the edited text first", async () => {
      writeRules(`${HAND_WRITTEN}\n${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n${COMMIT}\n`);
      expect(fs.readFileSync(checkLog, "utf8").split("\n").slice(0, 3)).toEqual([
        "execpolicy",
        "check",
        "--rules",
      ]);
      expect(fs.readFileSync(`${checkLog}.checked`, "utf8")).toBe(`${HAND_WRITTEN}\n${COMMIT}\n`);
    });

    it(`keeps a grant Codex saves while the check runs: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      configure({ CODEX_HOME: codexHome, FAKE_CODEX_SAVES: GITHUB_HOST });

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${COMMIT}\n${GITHUB_HOST}\n`);
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

    it("deletes a last line that has no line break", async () => {
      writeRules(`${HAND_WRITTEN}\n${GITHUB_HOST}`);
      const [githubHost] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, githubHost);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n`);
    });

    it(`leaves the file as it was, including a grant Codex saves meanwhile, and rejects with Codex's error when Codex can't read the edited text: ${ISSUE}`, async () => {
      writeRules(`${HAND_WRITTEN}\n${GH_API}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);
      configure({ CODEX_HOME: codexHome, FAKE_CODEX_FAIL: "1", FAKE_CODEX_SAVES: GITHUB_HOST });

      await expect(codexApprovedRules.remove(plugin, ghApi)).rejects.toThrow(
        `Codex couldn't read the rules file without it, so the file was left as it was. starlark error: Parse error: unexpected new line --> ${rulesFile()}:2:1`
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

    it(`finishes one removal before the next call reads the file, so quick removals all land: ${ISSUE}`, async () => {
      writeRules(`${GH_API}\n${COMMIT}\n${GITHUB_HOST}\n`);
      const [ghApi, commit] = await codexApprovedRules.list(plugin);

      const [, , remaining] = await Promise.all([
        codexApprovedRules.remove(plugin, ghApi),
        codexApprovedRules.remove(plugin, commit),
        codexApprovedRules.list(plugin),
      ]);

      expect(readRules()).toBe(`${GITHUB_HOST}\n`);
      expect(remaining.map((rule) => rule.id)).toEqual([GITHUB_HOST]);
    });
  });
});
