import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type CopilotPlugin from "@/main";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { codexApprovedRules } from "./codexApprovedRules";

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
].join("\n");
const GH_API = 'prefix_rule(pattern=["gh", "api"], decision="allow")';
const COMMIT = 'prefix_rule(pattern=["git", "commit", "-m", "it\'s done"], decision="allow")';
const GITHUB_HOST =
  'network_rule(host="api.github.com", protocol="https", decision="allow", justification="Allow https_connect access to api.github.com")';

const FAKE_BUNDLED_CODEX_RUNTIME = `#!/bin/sh
printf '%s\\n' "$@" "CODEX_HOME=$CODEX_HOME" "PATH=$PATH" > "$FAKE_CODEX_LOG"
if [ -n "$FAKE_CODEX_FAIL" ]; then
  echo "starlark error: Parse error: unexpected new line" >&2
  exit 1
fi
echo '{"matchedRules":[]}'
`;

describe("codexApprovedRules", () => {
  let codexHome: string;
  let bundle: string;
  let checkLog: string;
  const rulesFile = () => path.join(codexHome, "rules", "default.rules");
  const writeRules = (text: string) => {
    fs.mkdirSync(path.dirname(rulesFile()), { recursive: true });
    fs.writeFileSync(rulesFile(), text);
  };
  const readRules = () => fs.readFileSync(rulesFile(), "utf8");
  const configure = (envOverrides: Record<string, string> = {}) =>
    setSettings({
      agentMode: {
        ...getSettings().agentMode,
        backends: {
          codex: {
            binaryPath: path.join(bundle, "codex-acp"),
            binarySource: "managed",
            envOverrides: { CODEX_HOME: codexHome, FAKE_CODEX_LOG: checkLog, ...envOverrides },
          },
        },
      },
    });

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
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
    fs.rmSync(codexHome, { recursive: true, force: true });
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

    it(`reads the CODEX_HOME codex-acp gets: the user's Codex env override over Obsidian's own environment: ${ISSUE}`, async () => {
      const inheritedHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-inherited-home-"));
      const savedHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = inheritedHome;
      try {
        writeRules(`${GH_API}\n`);
        fs.mkdirSync(path.join(inheritedHome, "rules"));
        fs.writeFileSync(path.join(inheritedHome, "rules", "default.rules"), `${COMMIT}\n`);

        const fromOverride = await codexApprovedRules.list(plugin);
        configure({ CODEX_HOME: "" });
        const fromInherited = await codexApprovedRules.list(plugin);

        expect(fromOverride.map((rule) => rule.id)).toEqual([GH_API]);
        expect(fromInherited.map((rule) => [rule.id, rule.appliesTo])).toEqual([
          [COMMIT, { kind: "file", path: path.join(inheritedHome, "rules", "default.rules") }],
        ]);
      } finally {
        if (savedHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = savedHome;
        fs.rmSync(inheritedHome, { recursive: true, force: true });
      }
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
    it("deletes only that rule's line, keeps every other byte, and checks the file with the configured Codex", async () => {
      writeRules(`${HAND_WRITTEN}\n${GH_API}\n${COMMIT}\n`);
      const [ghApi] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, ghApi);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n${COMMIT}\n`);
      expect(fs.readFileSync(checkLog, "utf8").split("\n").slice(0, 4)).toEqual([
        "execpolicy",
        "check",
        "--rules",
        rulesFile(),
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

    it("deletes a last line that has no line break", async () => {
      writeRules(`${HAND_WRITTEN}\n${GITHUB_HOST}`);
      const [githubHost] = await codexApprovedRules.list(plugin);

      await codexApprovedRules.remove(plugin, githubHost);

      expect(readRules()).toBe(`${HAND_WRITTEN}\n`);
    });

    it(`puts the previous bytes back and rejects with Codex's error when Codex can't read the edited file: ${ISSUE}`, async () => {
      const before = `${HAND_WRITTEN}\n${GH_API}\n`;
      writeRules(before);
      const [ghApi] = await codexApprovedRules.list(plugin);
      configure({ FAKE_CODEX_FAIL: "1" });

      await expect(codexApprovedRules.remove(plugin, ghApi)).rejects.toThrow(
        "Codex couldn't read the rules file without it, so the file was left as it was. starlark error: Parse error"
      );
      expect(readRules()).toBe(before);
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
