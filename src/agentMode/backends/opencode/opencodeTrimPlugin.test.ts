import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vm from "vm";
import { logWarn } from "@/logger";
import {
  installOpencodeTrimPlugin,
  OPENCODE_TRIM_PLUGIN_SOURCE,
  opencodeTrimPluginDir,
} from "./opencodeTrimPlugin";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type Hook = (event: unknown) => void;

interface LoadedPlugin {
  id: string;
  setup: (ctx: unknown) => Promise<void>;
}

const ENV_INTRO = "Here is some useful information about the environment you are running in:";

const ENV_BLOCK = [
  ENV_INTRO,
  "<env>",
  "  Working directory: /vault",
  "  Workspace root folder: /vault",
  "  Is directory a git repo: no",
  "  Platform: darwin",
  "  Prefer /tmp/opencode over generic system temporary directories such as /tmp; it is pre-created and approved for external access.",
  "</env>",
].join("\n");

const ENV_BLOCK_TRIMMED = [
  ENV_INTRO,
  "<env>",
  "  Working directory: /vault",
  "  Workspace root folder: /vault",
  "  Is directory a git repo: no",
  "  Platform: darwin",
  "</env>",
].join("\n");

const WORKTREE_HINT =
  "When you create a worktree outside the current working directory and intend to use it as your primary working directory, consider using `execute` to call `tools.opencode.session_move` and make the worktree the session's working directory.";

async function setUpPlugin(plugin: LoadedPlugin) {
  const hooks = new Map<string, Hook>();
  const skills = new Map([
    ["opencode", {}],
    ["report", {}],
  ]);
  await plugin.setup({
    session: { hook: async (name: string, hook: Hook) => void hooks.set(name, hook) },
    skill: {
      transform: async (edit: (editor: { remove: (id: string) => void }) => void) =>
        edit({ remove: (id) => void skills.delete(id) }),
    },
  });
  return { hooks, skills };
}

describe("opencodeTrimPlugin", () => {
  describe("OPENCODE_TRIM_PLUGIN_SOURCE", () => {
    let pluginRoot: string;
    let plugin: LoadedPlugin;

    beforeAll(async () => {
      pluginRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-trim-load-"));
      await installOpencodeTrimPlugin(pluginRoot);
      const source = await fs.promises.readFile(path.join(pluginRoot, "index.js"), "utf8");
      const module = { exports: {} as LoadedPlugin };
      vm.runInThisContext(`(function (module) {${source}\n})`)(module);
      plugin = module.exports;
    });

    afterAll(async () => {
      await fs.promises.rm(pluginRoot, { recursive: true, force: true });
    });

    async function contextHook(): Promise<Hook> {
      const { hooks } = await setUpPlugin(plugin);
      return hooks.get("context")!;
    }

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/665 trims every request kind and removes only the built-in report skill", async () => {
      const { hooks, skills } = await setUpPlugin(plugin);

      expect(plugin.id).toBe("copilot.trim");
      expect([...hooks.keys()]).toEqual(["context", "compaction", "generate"]);
      expect(new Set(hooks.values()).size).toBe(1);
      expect([...skills.keys()]).toEqual(["opencode"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/665 removes the temp-folder line and the worktree hint while leaving every other system part as it was", async () => {
      const copilotPrompt = { type: "text", text: "You are Obsidian Copilot.\n" };
      const identity = { type: "text", text: "# Your Model\n- Name: Flash" };
      const event = {
        system: [
          copilotPrompt,
          identity,
          { type: "text", text: ENV_BLOCK },
          { type: "text", text: WORKTREE_HINT },
        ],
        messages: [],
      };

      (await contextHook())(event);

      expect(event.system).toEqual([
        copilotPrompt,
        identity,
        { type: "text", text: ENV_BLOCK_TRIMMED },
      ]);
      expect(event.system[0]).toBe(copilotPrompt);
      expect(event.system[1]).toBe(identity);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/665 removes the temp-folder line from a mid-session environment update but not from user messages", async () => {
      const changed = (text: string) =>
        text.replace(ENV_INTRO, "The environment you are running in is now:");
      const userText = { type: "text", text: ENV_BLOCK };
      const effort = { type: "effort", effort: "high" };
      const event = {
        system: [],
        messages: [
          { role: "user", content: [userText] },
          { role: "system", content: [{ type: "text", text: changed(ENV_BLOCK) }, effort] },
        ],
      };

      (await contextHook())(event);

      expect(event.messages[0].content).toEqual([userText]);
      expect(event.messages[1].content).toEqual([
        { type: "text", text: changed(ENV_BLOCK_TRIMMED) },
        effort,
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/665 swallows an unexpected request shape so the turn still reaches the model", async () => {
      const hook = await contextHook();

      expect(() => hook({ system: "not a list", messages: null })).not.toThrow();
    });
  });

  describe("opencodeTrimPluginDir()", () => {
    it("places the plugin in Copilot's managed OpenCode folder outside the vault", () => {
      expect(opencodeTrimPluginDir()).toBe(
        path.join(os.homedir(), ".obsidian-copilot", "opencode", "plugins", "copilot-trim")
      );
    });
  });

  describe("installOpencodeTrimPlugin()", () => {
    let root: string;

    beforeEach(async () => {
      root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-trim-plugin-"));
      jest.mocked(logWarn).mockClear();
    });

    afterEach(async () => {
      await fs.promises.rm(root, { recursive: true, force: true });
    });

    it("writes the plugin as a folder whose index.js holds the plugin source", async () => {
      const dir = path.join(root, "plugins", "copilot-trim");

      await expect(installOpencodeTrimPlugin(dir)).resolves.toBe(dir);

      expect(await fs.promises.readdir(dir)).toEqual(["index.js"]);
      expect(await fs.promises.readFile(path.join(dir, "index.js"), "utf8")).toBe(
        OPENCODE_TRIM_PLUGIN_SOURCE
      );
    });

    it("leaves a current plugin file untouched so running OpenCode sessions do not reload it", async () => {
      const entry = path.join(root, "index.js");
      await fs.promises.writeFile(entry, OPENCODE_TRIM_PLUGIN_SOURCE);
      const past = new Date("2026-01-01T00:00:00Z");
      await fs.promises.utimes(entry, past, past);

      await expect(installOpencodeTrimPlugin(root)).resolves.toBe(root);

      expect((await fs.promises.stat(entry)).mtime).toEqual(past);
    });

    it("replaces a plugin file left by another Copilot version", async () => {
      await fs.promises.writeFile(path.join(root, "index.js"), "module.exports = {};");

      await installOpencodeTrimPlugin(root);

      expect(await fs.promises.readFile(path.join(root, "index.js"), "utf8")).toBe(
        OPENCODE_TRIM_PLUGIN_SOURCE
      );
    });

    it("returns no folder and warns when the plugin cannot be written, so OpenCode starts without it", async () => {
      const blocker = path.join(root, "blocker");
      await fs.promises.writeFile(blocker, "");

      await expect(installOpencodeTrimPlugin(path.join(blocker, "copilot-trim"))).resolves.toBe(
        undefined
      );

      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining("could not write Copilot's OpenCode plugin"),
        expect.anything()
      );
    });
  });
});
