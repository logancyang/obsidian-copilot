import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { opencodeManagedDataDir } from "./OpencodeBinaryManager";

// OpenCode's coding-harness steering sent a user's draft to OpenCode's temp
// folder, outside the vault; its config cannot drop that text, but a plugin can.
// The plugin also drops the built-in `report` skill, because a skill deny rule
// would hide a user's own skill named `report` too.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/665
// It also reads each file an edit, write or patch is about to change and returns that text with
// the tool's result, because OpenCode names the file only milliseconds before writing it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/687
export const OPENCODE_TRIM_PLUGIN_SOURCE = `"use strict";
const fs = require("fs");
const path = require("path");
const TEMP_DIR_LINE = /^[ \\t]*Prefer .+ over generic system temporary directories[^\\n]*\\n?/gm;
const WORKTREE_HINT = /When you create a worktree outside the current working directory[^\\n]*/g;

function trimParts(parts) {
  const kept = [];
  for (const part of parts) {
    if (part.type !== "text") {
      kept.push(part);
      continue;
    }
    const text = part.text.replace(TEMP_DIR_LINE, "").replace(WORKTREE_HINT, "");
    if (text === part.text) kept.push(part);
    else if (text.trim()) kept.push({ ...part, text });
  }
  parts.splice(0, parts.length, ...kept);
}

function trimRequest(event) {
  try {
    trimParts(event.system);
    for (const message of event.messages) {
      if (message.role === "system") trimParts(message.content);
    }
  } catch {}
}

const PATCH_FILE_HEADER = /^\\*\\*\\* (?:Add File|Delete File|Update File|Move to): (.+)$/;

function writeTargets(tool, input) {
  if (!input || typeof input !== "object") return [];
  if (tool === "edit" || tool === "write") {
    const file = typeof input.path === "string" ? input.path : input.filePath;
    return typeof file === "string" && file ? [file] : [];
  }
  if (tool !== "patch" || typeof input.patchText !== "string") return [];
  return input.patchText.split("\\n").flatMap((line) => {
    const header = PATCH_FILE_HEADER.exec(line.trim());
    return header && header[1].trim() ? [header[1].trim()] : [];
  });
}

async function readOriginal(file) {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (error) {
    return error && error.code === "ENOENT" ? null : undefined;
  }
}

function captureOriginals(ctx) {
  const pending = new Map();
  return {
    before: async (event) => {
      try {
        const files = {};
        for (const file of writeTargets(event.tool, event.input)) {
          const absolute = path.resolve(ctx.location.directory, file);
          const text = await readOriginal(absolute);
          if (text !== undefined) files[absolute] = text;
        }
        if (Object.keys(files).length > 0) pending.set(event.id, files);
      } catch {}
    },
    after: (event) => {
      const files = pending.get(event.id);
      pending.delete(event.id);
      if (!files || event.status !== "completed") return;
      try {
        event.result.metadata = { ...event.result.metadata, copilot: { originalFiles: files } };
      } catch {}
    },
  };
}

module.exports = {
  id: "copilot.trim",
  setup: async (ctx) => {
    for (const hook of ["context", "compaction", "generate"]) {
      await ctx.session.hook(hook, trimRequest);
    }
    await ctx.skill.transform((skills) => skills.remove("report"));
    const originals = captureOriginals(ctx);
    await ctx.tool.hook("execute.before", originals.before);
    await ctx.tool.hook("execute.after", originals.after);
  },
};
`;

export function opencodeTrimPluginDir(): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return path.join(opencodeManagedDataDir(os.homedir()), "plugins", "copilot-trim");
}

export async function installOpencodeTrimPlugin(pluginDir: string): Promise<string | undefined> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  const path = requireNodeModule<typeof import("node:path")>("path");
  const entry = path.join(pluginDir, "index.js");
  try {
    const current = await fs.readFile(entry, "utf8").catch(() => undefined);
    if (current === OPENCODE_TRIM_PLUGIN_SOURCE) return pluginDir;
    await fs.mkdir(pluginDir, { recursive: true });
    const staged = `${entry}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(staged, OPENCODE_TRIM_PLUGIN_SOURCE);
    await fs.rename(staged, entry);
    return pluginDir;
  } catch (error) {
    logWarn(
      `[AgentMode] could not write Copilot's OpenCode plugin to ${pluginDir}; OpenCode keeps its full prompt.`,
      error
    );
    return undefined;
  }
}
