import * as path from "node:path";
import * as os from "os";
import * as fs from "node:fs";
import { signOutFromClaude } from "./claudeAuth";
jest.mock("./claudeAuth", () => ({ signOutFromClaude: jest.fn() }));
jest.mock("os", () => {
  const actual = jest.requireActual<typeof import("os")>("os");
  return { ...actual, homedir: jest.fn(() => actual.homedir()) };
});

import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState } from "@/agentMode/session/types";
import { getSettings, resetSettings, setSettings, type CopilotSettings } from "@/settings/model";
import type CopilotPlugin from "@/main";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { FileSystemAdapter, type App } from "obsidian";
import { resolveClaudeBinary } from "./claudeBinaryResolver";
import { probeClaudeVersion } from "./claudeVersion";
import {
  ClaudeBackendDescriptor,
  clearClaudeAutoMemory,
  getClaudeInstallState,
  isClaudeAutoMemoryOn,
  readClaudeAutoMemory,
  refreshClaudeInstallState,
  resolveClaudeAutoModePermission,
  subscribeClaudeInstallState,
  updateClaudeFields,
} from "./descriptor";

jest.mock("./claudeBinaryResolver", () => ({
  claudeBinarySearchDirs: jest.fn(() => []),
  resolveClaudeBinary: jest.fn(),
}));

jest.mock("./claudeVersion", () => ({
  ...jest.requireActual("./claudeVersion"),
  probeClaudeVersion: jest.fn(),
}));

const mockResolveClaudeBinary = resolveClaudeBinary as jest.MockedFunction<
  typeof resolveClaudeBinary
>;
const mockProbeClaudeVersion = probeClaudeVersion as jest.MockedFunction<typeof probeClaudeVersion>;

function settingsWithClaudeRuntime(options: {
  path?: string;
  envOverrides?: Record<string, string>;
}): CopilotSettings {
  return {
    agentMode: {
      claudeCli: options.path ? { path: options.path } : undefined,
      backends: {
        claude: {
          envOverrides: options.envOverrides,
        },
      },
    },
  } as unknown as CopilotSettings;
}

describe("descriptor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("ClaudeBackendDescriptor.auth.getProbeKey()", () => {
    afterEach(() => jest.restoreAllMocks());
    it.each(["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates authentication when effective %s changes without exposing secrets",
      (variable) => {
        mockResolveClaudeBinary.mockReturnValue("/cli");
        const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
        const changed = ClaudeBackendDescriptor.auth.getProbeKey!(
          settingsWithClaudeRuntime({ envOverrides: { [variable]: "private-fixture-value" } })
        );
        expect(changed).not.toBe(original);
        expect(changed).toMatch(/^[a-f0-9]{64}$/);
        expect(changed).not.toContain("private-fixture-value");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates a newly resolved CLI", () => {
      mockResolveClaudeBinary.mockReturnValueOnce("/first/cli").mockReturnValueOnce("/second/cli");
      const settings = settingsWithClaudeRuntime({});
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settings)).not.toBe(
        ClaudeBackendDescriptor.auth.getProbeKey!(settings)
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves identity when override order or provenance changes without changing the effective profile", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", {
        CLAUDE_CONFIG_DIR: "/profile",
        ANTHROPIC_API_KEY: "private-fixture-key",
      });
      const inherited = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      const overridden = ClaudeBackendDescriptor.auth.getProbeKey!(
        settingsWithClaudeRuntime({
          envOverrides: { ANTHROPIC_API_KEY: "private-fixture-key", CLAUDE_CONFIG_DIR: "/profile" },
        })
      );
      expect(inherited).toBe(overridden);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates an inherited credential change", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "first-fixture" });
      const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "second-fixture" });
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}))).not.toBe(
        original
      );
    });
  });

  describe("ClaudeBackendDescriptor.auth.signOut()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 signs out using the session CLI and profile and preserves the resulting account label", async () => {
      mockResolveClaudeBinary.mockReturnValue("/custom/claude");
      jest
        .mocked(signOutFromClaude)
        .mockResolvedValue({ loggedIn: true, label: "zero@example.com (max)" });
      const options = { signal: new AbortController().signal };
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(
          settingsWithClaudeRuntime({ envOverrides: { CLAUDE_CONFIG_DIR: "/custom profile" } }),
          options
        )
      ).resolves.toEqual({ signedIn: true, label: "zero@example.com (max)" });
      expect(signOutFromClaude).toHaveBeenCalledWith(
        "/custom/claude",
        expect.objectContaining({ CLAUDE_CONFIG_DIR: "/custom profile" }),
        options
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 does not claim credentials were removed when the CLI is missing", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(settingsWithClaudeRuntime({}))
      ).rejects.toThrow("Install Claude Code before signing out");
      expect(signOutFromClaude).not.toHaveBeenCalled();
    });
  });
  describe("ClaudeBackendDescriptor.dataDestination()", () => {
    const serverEnvKeys = [
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CONFIG_DIR",
    ];
    const saved = serverEnvKeys.map((key) => [key, process.env[key]] as const);
    let configDir: string;
    let vaultBase: string;
    const writeJson = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    };
    const destination = (envOverrides: Record<string, string> = {}) =>
      ClaudeBackendDescriptor.dataDestination!(
        settingsWithClaudeRuntime({
          envOverrides: { CLAUDE_CONFIG_DIR: configDir, ...envOverrides },
        }),
        vaultBase
      );
    beforeEach(() => {
      for (const key of serverEnvKeys) delete process.env[key];
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
      vaultBase = fs.mkdtempSync(path.join(os.tmpdir(), "claude-vault-"));
    });
    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(vaultBase, { recursive: true, force: true });
    });

    it("names Anthropic when nothing sets another server, even with an unreadable settings file", () => {
      writeJson(path.join(configDir, "settings.json"), "{not json");
      expect(destination()).toEqual({ kind: "cloud", label: "Anthropic" });
    });

    it.each([
      [
        "a plugin override sets a cloud base URL",
        () => ({ ANTHROPIC_BASE_URL: "https://proxy.example" }),
        { kind: "cloud", label: "The server set in your Claude Code settings" },
      ],
      [
        "a plugin override sets a local base URL",
        () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" }),
        { kind: "local", label: "A server on this computer" },
      ],
      [
        "only the Claude config folder's settings.json turns on Bedrock",
        () => {
          writeJson(path.join(configDir, "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "1" },
          });
          return {};
        },
        { kind: "cloud", label: "Amazon Bedrock" },
      ],
      [
        "the vault's .claude/settings.local.json turns on Vertex",
        () => {
          writeJson(path.join(vaultBase, ".claude", "settings.local.json"), {
            env: { CLAUDE_CODE_USE_VERTEX: "1" },
          });
          return {};
        },
        { kind: "cloud", label: "Google Vertex AI" },
      ],
      [
        "the vault's .claude/settings.json turns Bedrock off again",
        () => {
          writeJson(path.join(configDir, "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "1" },
          });
          writeJson(path.join(vaultBase, ".claude", "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "0" },
          });
          return {};
        },
        { kind: "cloud", label: "Anthropic" },
      ],
    ])(
      "names the destination when %s for https://github.com/logancyang/obsidian-copilot/issues/2889",
      (_source, arrange, expected) => {
        expect(destination(arrange())).toEqual(expected);
      }
    );
  });

  describe("ClaudeBackendDescriptor.approvedRules", () => {
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    let homeDir: string;
    let configDir: string;
    let vaultBase: string;
    let plugin: CopilotPlugin;
    const userFile = () => path.join(configDir, "settings.json");
    const projectFile = () => path.join(vaultBase, ".claude", "settings.json");
    const localFile = () => path.join(vaultBase, ".claude", "settings.local.json");
    const writeJson = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
    };
    const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
    const store = () => ClaudeBackendDescriptor.approvedRules!;

    beforeEach(() => {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-home-"));
      jest.mocked(os.homedir).mockReturnValue(homeDir);
      delete process.env.CLAUDE_CONFIG_DIR;
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
      vaultBase = fs.mkdtempSync(path.join(os.tmpdir(), "claude-vault-"));
      resetSettings();
      __resetVaultBaseCache();
      setSettings({
        agentMode: {
          ...getSettings().agentMode,
          backends: { claude: { envOverrides: { CLAUDE_CONFIG_DIR: configDir } } },
        },
      });
      const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
      adapter.getBasePath = () => vaultBase;
      plugin = { app: { vault: { adapter } } } as never;
    });
    afterEach(() => {
      resetSettings();
      __resetVaultBaseCache();
      jest.mocked(os.homedir).mockReset();
      if (savedConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(vaultBase, { recursive: true, force: true });
    });

    describe("list()", () => {
      it("lists every allow rule from the Claude config folder's settings.json and the vault's .claude/settings.json and settings.local.json, each with its file", async () => {
        writeJson(userFile(), {
          permissions: { allow: ["Bash(git status:*)"], deny: ["Bash(rm:*)"] },
        });
        writeJson(projectFile(), { permissions: { allow: ["WebFetch(domain:example.com)"] } });
        writeJson(localFile(), {
          permissions: { allow: ["Bash(npm test:*)", "Read(//tmp/**)"], ask: ["Bash(curl:*)"] },
        });

        const rules = await store().list(plugin);

        expect(rules.map((rule) => [rule.allows, rule.appliesTo])).toEqual([
          ["Bash(git status:*)", { kind: "file", path: userFile() }],
          ["WebFetch(domain:example.com)", { kind: "file", path: projectFile() }],
          ["Bash(npm test:*)", { kind: "file", path: localFile() }],
          ["Read(//tmp/**)", { kind: "file", path: localFile() }],
        ]);
        expect(new Set(rules.map((rule) => rule.id)).size).toBe(4);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 lists no rules from a settings file that does not exist", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(ls:*)"] } });

        const rules = await store().list(plugin);

        expect(rules.map((rule) => rule.allows)).toEqual(["Bash(ls:*)"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 fails naming the file when a settings file isn't valid JSON, so the page shows it can't read the rules", async () => {
        writeJson(userFile(), { permissions: { allow: ["Bash(ls:*)"] } });
        writeJson(projectFile(), "{ not json");

        await expect(store().list(plugin)).rejects.toThrow(`${projectFile()} isn't valid JSON`);
      });
    });

    describe("remove()", () => {
      it("deletes only that rule from permissions.allow in its file and keeps every other key, value, and file as it was", async () => {
        writeJson(userFile(), { permissions: { allow: ["Bash(git status:*)"] } });
        writeJson(localFile(), {
          env: { HTTPS_PROXY: "http://proxy.example" },
          permissions: {
            allow: ["Bash(npm test:*)", "Read(//tmp/**)"],
            deny: ["Bash(rm:*)"],
            defaultMode: "default",
          },
          model: "sonnet",
        });
        const userBefore = fs.readFileSync(userFile(), "utf8");
        const rule = (await store().list(plugin)).find((r) => r.allows === "Bash(npm test:*)")!;

        await store().remove(plugin, rule);

        expect(readJson(localFile())).toEqual({
          env: { HTTPS_PROXY: "http://proxy.example" },
          permissions: {
            allow: ["Read(//tmp/**)"],
            deny: ["Bash(rm:*)"],
            defaultMode: "default",
          },
          model: "sonnet",
        });
        expect(fs.readFileSync(userFile(), "utf8")).toBe(userBefore);
        expect((await store().list(plugin)).map((r) => r.allows)).toEqual([
          "Bash(git status:*)",
          "Read(//tmp/**)",
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 leaves live settings untouched when staging the removal fails", async () => {
        writeJson(localFile(), {
          permissions: { allow: ["Bash(npm test:*)"] },
          env: { KEEP: "yes" },
        });
        const [rule] = await store().list(plugin);
        const before = fs.readFileSync(localFile(), "utf8");
        const open = jest.spyOn(fs.promises, "open").mockRejectedValueOnce(new Error("disk full"));
        try {
          await expect(store().remove(plugin, rule)).rejects.toThrow("disk full");
        } finally {
          open.mockRestore();
        }
        expect(fs.readFileSync(localFile(), "utf8")).toBe(before);
        expect(fs.readdirSync(path.dirname(localFile()))).toEqual(["settings.local.json"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 refuses to replace settings edited while the removal is being staged", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        const concurrent = {
          permissions: { allow: ["Bash(npm test:*)", "Read(//tmp/**)"] },
          model: "new model",
        };
        const mkdtemp = fs.promises.mkdtemp.bind(fs.promises);
        const staging = jest
          .spyOn(fs.promises, "mkdtemp")
          .mockImplementationOnce(async (prefix) => {
            const dir = await mkdtemp(prefix);
            writeJson(localFile(), concurrent);
            return dir;
          });
        try {
          await expect(store().remove(plugin, rule)).rejects.toThrow("changed while saving");
        } finally {
          staging.mockRestore();
        }
        expect(readJson(localFile())).toEqual(concurrent);
        expect(fs.readdirSync(path.dirname(localFile()))).toEqual(["settings.local.json"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 restores only the removed allowance and preserves settings and grants saved afterward", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        const removal = await store().remove(plugin, rule);
        expect(removal).toBeDefined();
        if (!removal) throw new Error("Expected an undoable removal");
        writeJson(localFile(), {
          permissions: { allow: ["Read(//tmp/**)"], deny: ["Bash(rm:*)"] },
          model: "new model",
        });

        await removal.undo();

        expect(readJson(localFile())).toEqual({
          permissions: { allow: ["Read(//tmp/**)", "Bash(npm test:*)"], deny: ["Bash(rm:*)"] },
          model: "new model",
        });
        const restored = fs.readFileSync(localFile(), "utf8");
        await removal.undo();
        expect(fs.readFileSync(localFile(), "utf8")).toBe(restored);
      });

      (process.platform === "win32" ? it.skip : it)(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/866 preserves restrictive POSIX permissions and a user's symlink when replacing settings",
        async () => {
          writeJson(userFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
          const target = path.join(configDir, "private-settings.json");
          fs.renameSync(userFile(), target);
          fs.chmodSync(target, 0o600);
          fs.symlinkSync(target, userFile());
          const [rule] = await store().list(plugin);

          await store().remove(plugin, rule);

          expect(fs.lstatSync(userFile()).isSymbolicLink()).toBe(true);
          expect(readJson(target)).toEqual({ permissions: { allow: [] } });
          if (process.platform !== "win32") expect(fs.statSync(target).mode & 0o777).toBe(0o600);
        }
      );

      (process.platform === "win32" ? it.skip : it)(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/866 respects a POSIX read-only settings file instead of bypassing it with a rename",
        async () => {
          writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
          const [rule] = await store().list(plugin);
          const before = fs.readFileSync(localFile(), "utf8");
          fs.chmodSync(localFile(), 0o400);
          await expect(store().remove(plugin, rule)).rejects.toThrow("EACCES");
          expect(fs.readFileSync(localFile(), "utf8")).toBe(before);
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 leaves the original file intact when atomic replacement fails", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        const before = fs.readFileSync(localFile(), "utf8");
        const rename = jest
          .spyOn(jest.requireActual<typeof import("fs")>("fs"), "renameSync")
          .mockImplementationOnce(() => {
            throw new Error("replacement denied");
          });
        try {
          await expect(store().remove(plugin, rule)).rejects.toThrow("replacement denied");
        } finally {
          rename.mockRestore();
        }
        expect(fs.readFileSync(localFile(), "utf8")).toBe(before);
        expect(fs.readdirSync(path.dirname(localFile()))).toEqual(["settings.local.json"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 refuses Undo when later edits removed the permissions list or made the settings invalid", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        const removal = await store().remove(plugin, rule);
        if (!removal) throw new Error("Expected an undoable removal");
        writeJson(localFile(), { model: "changed" });
        await expect(removal.undo()).rejects.toThrow("no longer has a permissions.allow list");
        expect(readJson(localFile())).toEqual({ model: "changed" });
        writeJson(localFile(), "{ invalid");
        await expect(removal.undo()).rejects.toThrow("isn't valid JSON");
        expect(fs.readFileSync(localFile(), "utf8")).toBe("{ invalid");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 leaves the file byte-for-byte as it was when it no longer holds the rule", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        const edited = '{"permissions":{"allow":["Bash(ls:*)"]},\n"model":   "sonnet"}';
        writeJson(localFile(), edited);

        await store().remove(plugin, rule);

        expect(fs.readFileSync(localFile(), "utf8")).toBe(edited);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/866 fails and leaves the file untouched when it stopped being valid JSON after the rule was listed", async () => {
        writeJson(localFile(), { permissions: { allow: ["Bash(npm test:*)"] } });
        const [rule] = await store().list(plugin);
        writeJson(localFile(), '{ "permissions": { "allow": ["Bash(npm test:*)"] ');

        await expect(store().remove(plugin, rule)).rejects.toThrow(
          `${localFile()} isn't valid JSON`
        );
        expect(fs.readFileSync(localFile(), "utf8")).toBe(
          '{ "permissions": { "allow": ["Bash(npm test:*)"] '
        );
      });
    });
  });

  describe("isClaudeAutoMemoryOn()", () => {
    it.each([
      [undefined, true],
      [true, true],
      [false, false],
    ])(
      "reads the auto memory switch %s as %s, so memory stays on until turned off",
      (autoMemory, on) => {
        const settings = { agentMode: { backends: { claude: { autoMemory } } } } as CopilotSettings;
        expect(isClaudeAutoMemoryOn(settings)).toBe(on);
      }
    );
  });

  describe("readClaudeAutoMemory()", () => {
    const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/2892";
    let root: string;
    let configDir: string;
    let vaultBase: string;
    const settings = (): CopilotSettings =>
      settingsWithClaudeRuntime({ envOverrides: { CLAUDE_CONFIG_DIR: configDir } });
    const memoryFolder = (folder: string) =>
      path.join(configDir, "projects", folder.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
    const writeJson = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value));
    };

    beforeEach(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-memory-")));
      jest.mocked(os.homedir).mockReturnValue(path.join(root, "home"));
      configDir = path.join(root, "config");
      vaultBase = path.join(root, "vault");
      fs.mkdirSync(vaultBase, { recursive: true });
    });
    afterEach(() => {
      jest.mocked(os.homedir).mockReset();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it(`lists the memory folders Claude Code keeps for the vault and its project chats, skipping ones never written (${ISSUE})`, async () => {
      const research = path.join(vaultBase, "Projects", "Research");
      const travel = path.join(vaultBase, "Projects", "Travel");
      fs.mkdirSync(memoryFolder(vaultBase), { recursive: true });
      fs.mkdirSync(memoryFolder(research), { recursive: true });

      await expect(
        readClaudeAutoMemory(settings(), vaultBase, [research, travel])
      ).resolves.toEqual({
        turnedOffInClaude: false,
        folders: [memoryFolder(vaultBase), memoryFolder(research)],
        folderSetInClaude: false,
      });
    });

    it(`lists one folder named for the git repository when the vault is inside one, as Claude Code keys memory by repository (${ISSUE})`, async () => {
      fs.mkdirSync(path.join(root, ".git"));
      fs.mkdirSync(memoryFolder(root), { recursive: true });

      const memory = await readClaudeAutoMemory(settings(), vaultBase, [
        path.join(vaultBase, "Projects", "Research"),
      ]);

      expect(memory.folders).toEqual([memoryFolder(root)]);
    });

    it.each([
      [
        "the user settings",
        () => writeJson(path.join(configDir, "settings.json"), { autoMemoryEnabled: false }),
      ],
      [
        "the vault's local settings",
        () =>
          writeJson(path.join(vaultBase, ".claude", "settings.local.json"), {
            autoMemoryEnabled: false,
          }),
      ],
      [
        "a settings file's env",
        () =>
          writeJson(path.join(configDir, "settings.json"), {
            env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
          }),
      ],
    ])(
      `reports memory turned off in Claude Code when %s turn it off (${ISSUE})`,
      async (_where, arrange) => {
        arrange();

        const memory = await readClaudeAutoMemory(settings(), vaultBase, []);

        expect(memory.turnedOffInClaude).toBe(true);
      }
    );

    it(`lets the vault's local settings turn memory back on over the user settings (${ISSUE})`, async () => {
      writeJson(path.join(configDir, "settings.json"), { autoMemoryEnabled: false });
      writeJson(path.join(vaultBase, ".claude", "settings.local.json"), {
        autoMemoryEnabled: true,
      });

      const memory = await readClaudeAutoMemory(settings(), vaultBase, []);

      expect(memory.turnedOffInClaude).toBe(false);
    });

    it(`lists a memory folder set in the user settings as set in Claude Code, expanding ~ (${ISSUE})`, async () => {
      writeJson(path.join(configDir, "settings.json"), { autoMemoryDirectory: "~/notes-memory" });
      fs.mkdirSync(path.join(root, "home", "notes-memory"), { recursive: true });

      await expect(readClaudeAutoMemory(settings(), vaultBase, [])).resolves.toEqual({
        turnedOffInClaude: false,
        folders: [path.join(root, "home", "notes-memory")],
        folderSetInClaude: true,
      });
    });

    it(`lists the memory folder the vault's local settings set over the user settings' one (${ISSUE})`, async () => {
      const folder = path.join(root, "vault-memory");
      writeJson(path.join(configDir, "settings.json"), { autoMemoryDirectory: "~/notes-memory" });
      writeJson(path.join(vaultBase, ".claude", "settings.local.json"), {
        autoMemoryDirectory: folder,
      });
      fs.mkdirSync(folder);

      await expect(readClaudeAutoMemory(settings(), vaultBase, [])).resolves.toEqual({
        turnedOffInClaude: false,
        folders: [folder],
        folderSetInClaude: true,
      });
    });
  });

  describe("clearClaudeAutoMemory()", () => {
    it("deletes the given memory folders and leaves another project's memory in place (https://github.com/logancyang/obsidian-copilot/issues/2892)", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-memory-"));
      const vaultMemory = path.join(root, "vault", "memory");
      const otherMemory = path.join(root, "other", "memory");
      fs.mkdirSync(vaultMemory, { recursive: true });
      fs.mkdirSync(otherMemory, { recursive: true });
      fs.writeFileSync(path.join(vaultMemory, "MEMORY.md"), "- writes in British English");
      fs.writeFileSync(path.join(otherMemory, "MEMORY.md"), "- other project");

      await clearClaudeAutoMemory([vaultMemory]);

      expect(fs.existsSync(vaultMemory)).toBe(false);
      expect(fs.readFileSync(path.join(otherMemory, "MEMORY.md"), "utf8")).toBe("- other project");
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe("ClaudeBackendDescriptor.createBackendProcess()", () => {
    afterEach(() => {
      resetSettings();
      __resetVaultBaseCache();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/736 hands global and Project sessions only the active vault's managed env, with no Miyo search scope", async () => {
      resetSettings();
      __resetVaultBaseCache();
      mockResolveClaudeBinary.mockReturnValue("/usr/local/bin/claude");
      setSettings({
        miyoSearchAll: false,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          debugFullFrames: false,
          offerFeedbackCards: true,
          notificationSound: false,
          notificationSoundId: "piano",
          skills: { folder: "copilot/skills" },
          backends: {},
        },
      });
      const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
      adapter.getBasePath = () => "/active-vault";
      const app = { vault: { adapter, getName: () => "active-vault" } } as unknown as App;

      const process = ClaudeBackendDescriptor.createBackendProcess({
        plugin: {} as never,
        app,
        clientVersion: "4.0.0",
        descriptor: ClaudeBackendDescriptor,
      }) as unknown as {
        opts: {
          getEnvOverrides?: () => Record<string, string> | undefined;
          getManagedEnv?: () => Promise<Readonly<Record<string, string>>>;
        };
      };

      const env = await process.opts.getManagedEnv?.();
      expect(env).toEqual({});
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/2892 hands new chats the current auto memory switch", () => {
      mockResolveClaudeBinary.mockReturnValue("/usr/local/bin/claude");
      const process = ClaudeBackendDescriptor.createBackendProcess({
        plugin: {} as never,
        app: {} as App,
        clientVersion: "4.0.0",
        descriptor: ClaudeBackendDescriptor,
      }) as unknown as { opts: { getAutoMemoryEnabled: () => boolean } };

      updateClaudeFields({ autoMemory: false });
      expect(process.opts.getAutoMemoryEnabled()).toBe(false);
      updateClaudeFields({ autoMemory: true });
      expect(process.opts.getAutoMemoryEnabled()).toBe(true);
    });
  });

  describe("getClaudeInstallState()", () => {
    it("returns a stable absent state when no executable resolves", () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      const first = getClaudeInstallState(settingsWithClaudeRuntime({}));

      expect(first).toEqual({ kind: "absent" });
      expect(getClaudeInstallState(settingsWithClaudeRuntime({}))).toBe(first);
    });

    it("reports checking for an executable that has not been probed yet", () => {
      mockResolveClaudeBinary.mockReturnValue("/unprobed/claude");

      expect(
        getClaudeInstallState(settingsWithClaudeRuntime({ path: "/unprobed/claude" }))
      ).toEqual({ kind: "checking", source: "custom" });
    });

    it("returns the probed state regardless of the order of environment overrides", async () => {
      mockResolveClaudeBinary.mockReturnValue("/ordered/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({
          path: "/ordered/claude",
          envOverrides: { ZED: "last", ALPHA: "first" },
        })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({
            path: "/ordered/claude",
            envOverrides: { ALPHA: "first", ZED: "last" },
          })
        )
      ).toEqual({ kind: "ready", source: "custom" });
    });

    it("reports checking again when the environment overrides change for the same executable", async () => {
      mockResolveClaudeBinary.mockReturnValue("/env-keyed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "a" } })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "b" } })
        )
      ).toEqual({ kind: "checking", source: "custom" });
    });
  });

  describe("refreshClaudeInstallState()", () => {
    it("returns absent without probing when no executable resolves", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      await expect(refreshClaudeInstallState(settingsWithClaudeRuntime({}), true)).resolves.toEqual(
        { kind: "absent" }
      );
      expect(mockProbeClaudeVersion).not.toHaveBeenCalled();
    });

    it("probes the managed executable and publishes a ready state for a supported version", async () => {
      mockResolveClaudeBinary.mockReturnValue("/managed/bin/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({});

      await expect(refreshClaudeInstallState(settings, true)).resolves.toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(getClaudeInstallState(settings)).toEqual({ kind: "ready", source: "managed" });
    });

    it("reuses the cached state unless a forced refresh is requested", async () => {
      mockResolveClaudeBinary.mockReturnValue("/forced/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({ path: "/forced/claude" });

      await refreshClaudeInstallState(settings);
      await refreshClaudeInstallState(settings);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(1);

      await refreshClaudeInstallState(settings, true);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribeClaudeInstallState()", () => {
    it("notifies the listener of install state changes until it unsubscribes", async () => {
      mockResolveClaudeBinary.mockReturnValue("/subscribed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const listener = jest.fn();
      const unsubscribe = subscribeClaudeInstallState(listener);

      await refreshClaudeInstallState(settingsWithClaudeRuntime({ path: "/subscribed/claude" }));
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      unsubscribe();
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/subscribed/claude" }),
        true
      );
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("ClaudeBackendDescriptor.applySelection()", () => {
    function makeSession(currentBaseModelId: string): {
      session: AgentSession;
      applyModelWireId: jest.Mock;
    } {
      const state: BackendState = {
        model: {
          current: { baseModelId: currentBaseModelId, effort: null },
          availableModels: [],
          apply: { kind: "setModel" },
        },
        mode: null,
      };
      const applyModelWireId = jest.fn(async () => undefined);
      return {
        session: {
          getState: () => state,
          applyModelWireId,
        } as unknown as AgentSession,
        applyModelWireId,
      };
    }

    it.each([null, "removed", "high"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies a concrete effort for preference %p",
      async (effort) => {
        const spy = jest.spyOn(ClaudeBackendDescriptor.wire, "effortConfigFor").mockReturnValue({
          id: "effort",
          type: "select",
          name: "Effort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        });
        const setConfigOption = jest.fn();
        const session = {
          getState: () => ({
            model: {
              current: { baseModelId: "sonnet", effort: "high" },
              availableModels: [
                {
                  baseModelId: "sonnet",
                  effortOptions: [
                    { value: "high", label: "High" },
                    { value: "low", label: "Low" },
                  ],
                },
              ],
            },
          }),
          setConfigOption,
        } as unknown as AgentSession;
        try {
          await ClaudeBackendDescriptor.applySelection(session, { baseModelId: "sonnet", effort });
          expect(setConfigOption).toHaveBeenCalledWith(
            "effort",
            effort === "high" ? "high" : "low"
          );
        } finally {
          spy.mockRestore();
        }
      }
    );

    it("skips the model write for an ordinary same-model selection", async () => {
      const { session, applyModelWireId } = makeSession("sonnet");

      await ClaudeBackendDescriptor.applySelection(session, {
        baseModelId: "sonnet",
        effort: null,
      });

      expect(applyModelWireId).not.toHaveBeenCalled();
    });
  });

  describe("resolveClaudeAutoModePermission()", () => {
    it("falls back to Claude's classifier mode when nothing is persisted", () => {
      expect(resolveClaudeAutoModePermission({ agentMode: {} } as CopilotSettings)).toBe("auto");
    });

    it("returns the persisted permission mode", () => {
      const settings = {
        agentMode: { backends: { claude: { autoModePermission: "acceptEdits" } } },
      } as unknown as CopilotSettings;

      expect(resolveClaudeAutoModePermission(settings)).toBe("acceptEdits");
    });
  });

  describe("ClaudeBackendDescriptor.getModeMapping()", () => {
    afterEach(() => {
      resetSettings();
    });

    it("points the auto pill at Claude's classifier mode by default", () => {
      resetSettings();

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)).toEqual({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "auto" },
        unlistedModeShowsAs: "auto",
      });
    });

    it("points the auto pill at the user's configured permission mode", () => {
      updateClaudeFields({ autoModePermission: "bypassPermissions" });

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)?.canonical.auto).toBe(
        "bypassPermissions"
      );
    });
  });
});
