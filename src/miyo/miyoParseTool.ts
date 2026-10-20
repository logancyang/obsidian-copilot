import type { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl } from "@/miyo/miyoRuntimePolicy";
import type { CopilotSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { toVaultRelative } from "@/utils/vaultPath";

export const MIYO_PARSE_TOOL_NAME = "miyo_parse";

// Codex cuts the middle out of any MCP output over about 40,000 UTF-8 bytes, so a long document comes back in parts the agent
// pages through instead of one cut-off dump. https://github.com/Brevilabs/obsidian-copilot-private/issues/740
const PART_BUDGET_BYTES = 32_000;

export const MIYO_PARSE_TOOL = Object.freeze({
  name: MIYO_PARSE_TOOL_NAME,
  description: `Convert one PDF or EPUB into Markdown/text with Miyo. A long document comes back in parts: when a part names a next offset, call again with that offset to read on. If it fails, tell the user, then read the file with any other tool you have; don't call it again for that file.`,
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

export interface MiyoParseDeps {
  client: Pick<MiyoClient, "resolveBaseUrl" | "parseDoc">;
  getSettings: () => CopilotSettings;
  getVaultName: () => string;
  getVaultBase: () => string | null;
}

export async function parseWithMiyo(
  path: string,
  { client, getSettings, getVaultName, getVaultBase }: MiyoParseDeps
): Promise<string> {
  const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(getSettings()));
  // A remote Miyo reads the vault from its own copy, so a vault file's absolute path on this computer is sent relative to the vault.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  const { text } = await client.parseDoc(
    baseUrl,
    getVaultName(),
    toVaultRelative(path, getVaultBase())
  );
  return text;
}
