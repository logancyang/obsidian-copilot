import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vm from "vm";
import { AGENT_WRITE_MAX_BYTES } from "@/agentMode/backends/shared/agentWriteLimit";
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
  const toolHooks = new Map<string, Hook>();
  const permissionHooks = new Map<string, Hook>();
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
    tool: { hook: async (name: string, hook: Hook) => void toolHooks.set(name, hook) },
    permission: { hook: async (name: string, hook: Hook) => void permissionHooks.set(name, hook) },
  });
  return { hooks, skills, toolHooks, permissionHooks };
}

const ISSUE_641 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/641";

interface Evaluation {
  effect: string;
  message?: string;
}

async function writeGuard(plugin: LoadedPlugin) {
  const { toolHooks, permissionHooks } = await setUpPlugin(plugin);
  let callCount = 0;
  return (tool: string, input: Record<string, unknown>, effect = "allow"): Evaluation => {
    const id = `call-${++callCount}`;
    toolHooks.get("execute.before")!({ tool, id, input });
    const evaluation: Evaluation & Record<string, unknown> = {
      action: "edit",
      resources: ["note.md"],
      source: { type: "tool", messageID: "message-1", id },
      effect,
    };
    permissionHooks.get("evaluate")!(evaluation);
    toolHooks.get("execute.after")!({ tool, id, input, status: "completed" });
    return {
      effect: evaluation.effect,
      ...(evaluation.message ? { message: evaluation.message } : {}),
    };
  };
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

  describe("OPENCODE_TRIM_PLUGIN_SOURCE write guard", () => {
    let pluginRoot: string;
    let plugin: LoadedPlugin;

    beforeAll(async () => {
      pluginRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-trim-guard-"));
      await installOpencodeTrimPlugin(pluginRoot);
      const source = await fs.promises.readFile(path.join(pluginRoot, "index.js"), "utf8");
      const module = { exports: {} as LoadedPlugin };
      vm.runInThisContext(`(function (module) {${source}\n})`)(module);
      plugin = module.exports;
    });

    afterAll(async () => {
      await fs.promises.rm(pluginRoot, { recursive: true, force: true });
    });

    it(`${ISSUE_641} keeps a ${AGENT_WRITE_MAX_BYTES}-byte write and denies one byte more, telling the agent to write in parts`, async () => {
      const call = await writeGuard(plugin);

      expect(
        call("write", { path: "note.md", content: "a".repeat(AGENT_WRITE_MAX_BYTES) })
      ).toEqual({
        effect: "allow",
      });
      const denied = call("write", {
        path: "note.md",
        content: "a".repeat(AGENT_WRITE_MAX_BYTES + 1),
      });
      expect(denied.effect).toBe("deny");
      expect(denied.message).toMatch(/^Nothing was written: this call is over 40 KB/);
      expect(denied.message).toContain("Write the file in parts");
    });

    it(`${ISSUE_641} counts UTF-8 bytes, so 13,334 Han characters (40,002 bytes) are denied`, async () => {
      const call = await writeGuard(plugin);

      expect(call("write", { path: "note.md", content: "漢".repeat(13_334) }).effect).toBe("deny");
    });

    it(`${ISSUE_641} denies an empty write as a cut-off reply and keeps a single newline`, async () => {
      const call = await writeGuard(plugin);

      const denied = call("write", { path: "note.md", content: "" });
      expect(denied.effect).toBe("deny");
      expect(denied.message).toContain("usually means your reply hit the output limit");
      expect(denied.message).toContain("write a single newline");
      expect(call("write", { path: "note.md", content: "\n" }).effect).toBe("allow");
    });

    it(`${ISSUE_641} denies an oversized edit or patch`, async () => {
      const call = await writeGuard(plugin);
      const big = "a".repeat(AGENT_WRITE_MAX_BYTES + 1);

      expect(call("edit", { path: "note.md", oldString: "x", newString: big }).effect).toBe("deny");
      expect(call("patch", { patchText: big }).effect).toBe("deny");
    });

    it(`${ISSUE_641} leaves small calls and other tools on their own effect, so Default mode still asks`, async () => {
      const call = await writeGuard(plugin);

      expect(call("write", { path: "note.md", content: "hello" }, "ask")).toEqual({
        effect: "ask",
      });
      expect(call("shell", { command: "a".repeat(AGENT_WRITE_MAX_BYTES + 1) }, "ask")).toEqual({
        effect: "ask",
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
