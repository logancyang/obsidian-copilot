import { err2String } from "@/utils";
import { requireNodeModule } from "@/utils/desktopRuntime";

export const MIYO_PARSE_TOOL_NAME = "miyo_parse";

// Codex cuts the middle out of any MCP output over about 40,000 UTF-8 bytes, so a long document comes back in parts the agent
// pages through instead of one cut-off dump. https://github.com/Brevilabs/obsidian-copilot-private/issues/740
const PART_BUDGET_BYTES = 32_000;
const PARSE_TIMEOUT_MS = 120_000;
const MAX_PARSED_BYTES = 256 * 1024 * 1024;

export const MIYO_PARSE_TOOL = Object.freeze({
  name: MIYO_PARSE_TOOL_NAME,
  description: `Convert one PDF or EPUB into Markdown/text with Miyo on this computer. The file can be anywhere on disk and doesn't need to be in the vault. A long document comes back in parts: when a part names a next offset, call again with that offset to read on. If it fails, tell the user, then read the file with any other tool you have; don't call it again for that file.`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path, or a path relative to the vault root." },
      offset: {
        type: "integer",
        minimum: 0,
        description: "The next offset a previous part named.",
      },
    },
    required: ["path"],
  },
  // Codex asks the user to approve MCP calls unless the tool is read-only, and parsing changes nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says how to page and recover.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  _meta: { "anthropic/alwaysLoad": true },
});

export const MIYO_PARSE_TURNED_OFF_TEXT = `${MIYO_PARSE_TOOL_NAME} is not available in this chat. Don't call it again; read the file with any other tool you have.`;

export interface MiyoParseToolResult {
  text: string;
  isError: boolean;
}

export function createMiyoParse(
  parse: (path: string) => Promise<string>
): (args: unknown) => Promise<MiyoParseToolResult> {
  // Paging re-requests the same document once per part, so the parsed text is kept until its last part is read instead of reparsing it every time.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  let paging: { path: string; text: string } | undefined;
  return async (args) => {
    const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const path = typeof input.path === "string" ? input.path : "";
    if (!path.trim()) return failure("path must be a non-empty string.");
    const offset =
      typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset > 0
        ? input.offset
        : 0;

    let text: string;
    if (offset > 0 && paging?.path === path) {
      text = paging.text;
    } else {
      try {
        text = (await parse(path)).replace(/\n+$/, "");
      } catch (error) {
        return failure(
          `Miyo could not parse ${path}. Tell the user, then read the file with any other tool you have; don't call ${MIYO_PARSE_TOOL_NAME} again for this file. Details: ${err2String(error)}`
        );
      }
    }
    if (offset > 0 && offset >= text.length) {
      return failure(`offset ${offset} is past the end of ${path} (${text.length} characters).`);
    }

    const end = partEnd(text, offset);
    paging = end < text.length ? { path, text } : undefined;
    if (offset === 0 && end === text.length) return { text, isError: false };
    const next =
      end < text.length
        ? `Call ${MIYO_PARSE_TOOL_NAME} again with offset ${end} for the next part.`
        : "End of document.";
    return {
      text: `${text.slice(offset, end)}\n\n[Characters ${offset}-${end} of ${text.length}. ${next}]`,
      isError: false,
    };
  };
}

function failure(text: string): MiyoParseToolResult {
  return { text, isError: true };
}

function partEnd(text: string, offset: number): number {
  const encoder = new TextEncoder();
  let end = Math.min(text.length, offset + PART_BUDGET_BYTES);
  while (encoder.encode(text.slice(offset, end)).length > PART_BUDGET_BYTES) {
    end = offset + Math.floor((end - offset) * 0.9);
  }
  // A part ending between an emoji's two UTF-16 halves would hand both parts an unpaired surrogate that decodes as garbage.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  const last = text.charCodeAt(end - 1);
  return end < text.length && last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
}

export async function parseWithMiyoCli(path: string, cwd: string | undefined): Promise<string> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  try {
    const { stdout } = await promisify(execFile)(resolveMiyoCli(), ["parse", path], {
      cwd,
      timeout: PARSE_TIMEOUT_MS,
      maxBuffer: MAX_PARSED_BYTES,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const { code, stderr } = error as { code?: unknown; stderr?: unknown };
    if (code === "ENOENT") {
      throw new Error(
        "Miyo CLI not found. The Miyo desktop app is not installed on this computer."
      );
    }
    throw new Error(
      typeof stderr === "string" && stderr.trim() ? stderr.trim() : err2String(error)
    );
  }
}

// Obsidian started from the Dock or Start menu misses the shell PATH, so Miyo's own install location comes first,
// unless a leftover there can't run and would shadow a working miyo on PATH.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/740
function resolveMiyoCli(): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const nodePath = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const installed =
    process.platform === "win32"
      ? nodePath.join(
          process.env.LOCALAPPDATA ?? nodePath.join(os.homedir(), "AppData", "Local"),
          "Miyo",
          "bin",
          "miyo",
          "miyo.exe"
        )
      : nodePath.join(os.homedir(), ".miyo", "bin", "miyo");
  try {
    fs.accessSync(installed, fs.constants.X_OK);
    return installed;
  } catch {
    return "miyo";
  }
}
