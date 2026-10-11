import { AGENT_WRITE_MAX_BYTES } from "@/agentMode/backends/shared/agentWriteLimit";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { opencodeManagedDataDir } from "./OpencodeBinaryManager";

// OpenCode's coding-harness steering sent a user's draft to OpenCode's temp
// folder, outside the vault; its config cannot drop that text, but a plugin can.
// The plugin also drops the built-in `report` skill, because a skill deny rule
// would hide a user's own skill named `report` too.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/665
// It also refuses an empty write and any write over the byte limit before it runs: OpenCode runs a
// write cut off at the step's output limit and saves an empty or partial note.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/641
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

const MAX_WRITE_BYTES = ${AGENT_WRITE_MAX_BYTES};
const IN_PARTS =
  " Write the file in parts: create it with the first part, then add each next part with one edit call per reply.";
const TOO_LARGE =
  "Nothing was written: this call is over ${AGENT_WRITE_MAX_BYTES / 1000} KB, too large to finish in one reply." + IN_PARTS;
const EMPTY =
  "Nothing was written: the content is empty, which usually means your reply hit the output limit." +
  IN_PARTS +
  " For an intended empty file, write a single newline.";
const refused = new Map();

function writtenText(tool, input) {
  if (!input || typeof input !== "object") return undefined;
  if (tool === "write") return input.content;
  if (tool === "edit") return input.newString;
  if (tool === "patch") return input.patchText;
  return undefined;
}

function utf8Bytes(text) {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function refusal(tool, input) {
  const text = writtenText(tool, input);
  if (typeof text !== "string") return undefined;
  if (tool === "write" && text === "") return EMPTY;
  if (utf8Bytes(text) > MAX_WRITE_BYTES) return TOO_LARGE;
  return undefined;
}

function recordRefusal(event) {
  try {
    const message = refusal(event.tool, event.input);
    if (message) refused.set(event.id, message);
  } catch {}
}

function denyRefused(event) {
  try {
    const source = event.source;
    const message = source && source.type === "tool" ? refused.get(source.id) : undefined;
    if (!message) return;
    event.effect = "deny";
    event.message = message;
  } catch {}
}

function forgetCall(event) {
  try {
    refused.delete(event.id);
  } catch {}
}

module.exports = {
  id: "copilot.trim",
  setup: async (ctx) => {
    for (const hook of ["context", "compaction", "generate"]) {
      await ctx.session.hook(hook, trimRequest);
    }
    await ctx.skill.transform((skills) => skills.remove("report"));
    await ctx.tool.hook("execute.before", recordRefusal);
    await ctx.permission.hook("evaluate", denyRefused);
    await ctx.tool.hook("execute.after", forgetCall);
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
