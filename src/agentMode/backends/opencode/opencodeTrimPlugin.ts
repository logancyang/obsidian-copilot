import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { opencodeManagedDataDir } from "./OpencodeBinaryManager";

// OpenCode's coding-harness steering sent a user's draft to OpenCode's temp
// folder, outside the vault; its config cannot drop that text, but a plugin can.
// The plugin also drops the built-in `report` skill, because a skill deny rule
// would hide a user's own skill named `report` too.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/665
export const OPENCODE_TRIM_PLUGIN_SOURCE = `"use strict";
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

module.exports = {
  id: "copilot.trim",
  setup: async (ctx) => {
    for (const hook of ["context", "compaction", "generate"]) {
      await ctx.session.hook(hook, trimRequest);
    }
    await ctx.skill.transform((skills) => skills.remove("report"));
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
