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
type ToolHook = (event: Record<string, unknown>) => Promise<void> | void;

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

async function setUpPlugin(plugin: LoadedPlugin, directory = "/vault") {
  const hooks = new Map<string, Hook>();
  const toolHooks = new Map<string, ToolHook>();
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
    tool: { hook: async (name: string, hook: ToolHook) => void toolHooks.set(name, hook) },
    location: { directory },
  });
  return { hooks, toolHooks, skills };
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
      vm.runInThisContext(`(function (module, require) {${source}\n})`)(module, require);
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

    describe("write-time originals", () => {
      let vault: string;

      beforeEach(async () => {
        vault = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-originals-"));
        await fs.promises.mkdir(path.join(vault, "notes"));
        await fs.promises.writeFile(path.join(vault, "notes/a.md"), "a before\n");
        await fs.promises.writeFile(path.join(vault, "notes/old.md"), "old before\n");
      });

      afterEach(async () => {
        await fs.promises.rm(vault, { recursive: true, force: true });
      });

      async function runTool(
        tool: string,
        input: unknown,
        write: () => Promise<void>,
        status: "completed" | "error" = "completed"
      ) {
        const { toolHooks } = await setUpPlugin(plugin, vault);
        await toolHooks.get("execute.before")!({ tool, id: "call-1", input });
        await write();
        const after: Record<string, unknown> = { tool, id: "call-1", input, status };
        if (status === "completed") after.result = { output: "ok", metadata: { files: [] } };
        await toolHooks.get("execute.after")!(after);
        return { after, toolHooks };
      }

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/687 returns the text an edit replaced alongside OpenCode's own metadata", async () => {
        const { after } = await runTool("edit", { path: "notes/a.md" }, () =>
          fs.promises.writeFile(path.join(vault, "notes/a.md"), "a after\n")
        );

        expect(after.result).toEqual({
          output: "ok",
          metadata: {
            files: [],
            copilot: { originalFiles: { [path.join(vault, "notes/a.md")]: "a before\n" } },
          },
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/687 reports a file a write created as having no original", async () => {
        const { after } = await runTool("write", { filePath: "notes/new.md" }, () =>
          fs.promises.writeFile(path.join(vault, "notes/new.md"), "fresh\n")
        );

        expect(after.result).toMatchObject({
          metadata: { copilot: { originalFiles: { [path.join(vault, "notes/new.md")]: null } } },
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/687 returns every file a patch adds, updates, deletes or moves", async () => {
        const patchText = [
          "*** Begin Patch",
          "*** Update File: notes/a.md",
          "@@",
          "-a before",
          "+a after",
          "*** Update File: notes/old.md",
          "*** Move to: notes/moved.md",
          "*** Add File: notes/new.md",
          "+fresh",
          "*** End Patch",
        ].join("\n");

        const { after } = await runTool("patch", { patchText }, async () => {
          await fs.promises.writeFile(path.join(vault, "notes/a.md"), "a after\n");
          await fs.promises.rename(
            path.join(vault, "notes/old.md"),
            path.join(vault, "notes/moved.md")
          );
        });

        expect(after.result).toMatchObject({
          metadata: {
            copilot: {
              originalFiles: {
                [path.join(vault, "notes/a.md")]: "a before\n",
                [path.join(vault, "notes/old.md")]: "old before\n",
                [path.join(vault, "notes/moved.md")]: null,
                [path.join(vault, "notes/new.md")]: null,
              },
            },
          },
        });
      });

      it("leaves reads and other tools' results untouched", async () => {
        const { after } = await runTool("read", { path: "notes/a.md" }, async () => {});

        expect(after.result).toEqual({ output: "ok", metadata: { files: [] } });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/687 forgets a failed call's originals so a later call with the same id reports only its own", async () => {
        const { toolHooks } = await runTool(
          "edit",
          { path: "notes/a.md" },
          async () => {},
          "error"
        );
        await toolHooks.get("execute.before")!({ tool: "read", id: "call-1", input: {} });
        const after: Record<string, unknown> = {
          tool: "read",
          id: "call-1",
          status: "completed",
          result: { output: "ok" },
        };
        await toolHooks.get("execute.after")!(after);

        expect(after.result).toEqual({ output: "ok" });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/687 never fails the tool when a target cannot be read", async () => {
        const { toolHooks } = await setUpPlugin(plugin, vault);
        const before = toolHooks.get("execute.before")!;

        await expect(
          before({ tool: "edit", id: "call-1", input: { path: "notes" } })
        ).resolves.toBeUndefined();
        await expect(before({ tool: "edit", id: "call-2", input: null })).resolves.toBeUndefined();
      });
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
