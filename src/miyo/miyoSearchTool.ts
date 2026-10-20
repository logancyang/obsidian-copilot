import type { MiyoClient, MiyoSearchResult } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl } from "@/miyo/miyoRuntimePolicy";
import {
  MIYO_SEARCH_CANDIDATE_LIMIT,
  searchWithoutMissingFolders,
} from "@/miyo/searchWithoutMissingFolders";
import type { CopilotSettings } from "@/settings/model";
import { err2String } from "@/utils";

export const MIYO_SEARCH_TOOL_NAME = "miyo_search";

const NOTE_LIMIT = 20;
const MAX_VARIANTS = 2;
// Codex cuts the middle out of any MCP output over about 10K tokens (40,000 UTF-8 bytes) and Claude Code saves
// output over its own cap to a file, either of which leaves the agent a result that no longer parses.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/734
const OUTPUT_BUDGET_BYTES = 32_000;

export const MIYO_SEARCH_TOOL = Object.freeze({
  name: MIYO_SEARCH_TOOL_NAME,
  description: `Semantic search over the user's notes: finds notes by meaning, not only exact words. Use it for any request the notes might answer, alongside grep for exact names and terms, with the user's full question as query. Searches the active vault plus the extra Miyo folders enabled in Copilot settings, or everything Miyo has when Copilot's search scope is Unrestricted. Returns up to ${NOTE_LIMIT} notes as { path, content } excerpts. A path is relative to the active vault, so you can open and link it as is. A note with a folder field lives in that Miyo folder outside the vault and its path is relative to that folder: use its content, cite it as folder and path in plain text, and don't open or link it. Cite the path of any note you use. If the search fails, continue with keyword search and don't retry in a loop.`,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      variants: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_VARIANTS,
        description: "Other phrasings of the same question.",
      },
    },
    required: ["query"],
  },
  // Codex asks the user to approve MCP calls unless the tool is read-only, and a search changes nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/734
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/734
  _meta: { "anthropic/alwaysLoad": true },
});

export const MIYO_SEARCH_TURNED_OFF_TEXT = `${MIYO_SEARCH_TOOL_NAME} is not available in this chat. Don't call it again.`;

export interface MiyoSearchToolResult {
  text: string;
  isError: boolean;
}

export type MiyoSearchRunner = (args: unknown) => Promise<MiyoSearchToolResult>;

export interface MiyoSearchDeps {
  client: Pick<MiyoClient, "resolveBaseUrl" | "search">;
  getSettings: () => CopilotSettings;
  getVaultName: () => string;
}

interface FileResult {
  folder?: string;
  path: string;
  content: string;
}

export async function runMiyoSearch(
  args: unknown,
  { client, getSettings, getVaultName }: MiyoSearchDeps
): Promise<MiyoSearchToolResult> {
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) return failure("query must be a non-empty string.");
  const variants = Array.isArray(input.variants)
    ? input.variants.filter((v): v is string => typeof v === "string").slice(0, MAX_VARIANTS)
    : [];

  const settings = getSettings();
  const unrestricted = settings.miyoSearchAll === true;
  const vaultName = getVaultName();
  // Ticked folders widen only Current vault scope.
  // https://github.com/logancyang/obsidian-copilot/issues/3508
  const extraFolders = unrestricted
    ? []
    : settings.miyoExtraSearchFolders.filter((name) => name !== vaultName);

  try {
    const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
    const folderName = unrestricted ? undefined : vaultName;
    const searched = await searchWithoutMissingFolders(
      (folderNames) =>
        client.search(baseUrl, folderName, query, MIYO_SEARCH_CANDIDATE_LIMIT, {
          variants,
          folderNames,
        }),
      folderName,
      extraFolders
    );
    const skipped = extraFolders.filter((name) => !searched.extraFolders.includes(name));
    return {
      text: serialize(
        toNotes(searched.response.results ?? [], vaultName),
        skipped.length > 0
          ? `Miyo has no folder ${skipped.map((name) => `"${name}"`).join(", ")} ticked in Copilot settings, so it was not searched.`
          : undefined
      ),
      isError: false,
    };
  } catch (error) {
    return failure(
      `Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: ${err2String(error)}`
    );
  }
}

function failure(text: string): MiyoSearchToolResult {
  return { text, isError: true };
}

// Miyo ranks chunks, so one long note can fill them all; grouping by note keeps the other notes visible.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/734
function toNotes(chunks: readonly MiyoSearchResult[], vaultName: string): FileResult[] {
  const excerptsByPath = new Map<string, string[]>();
  for (const { path, chunk_text } of chunks) {
    const text = (chunk_text ?? "").replace(/^[\s\S]*?NOTE BLOCK CONTENT:/, "").trim();
    excerptsByPath.set(path, [...(excerptsByPath.get(path) ?? []), ...(text ? [text] : [])]);
  }
  return [...excerptsByPath].slice(0, NOTE_LIMIT).map(([path, excerpts]) => ({
    ...locate(path, vaultName),
    content: excerpts.join("\n\n"),
  }));
}

// Miyo prefixes each path with its folder's name, which names no folder inside the vault, so the agent could not open or link the
// note; a note from another Miyo folder names that folder apart, or a ticked folder named like a vault folder reads as a vault note.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
function locate(path: string, vaultName: string): Pick<FileResult, "folder" | "path"> {
  const [folder, ...rest] = path.replace(/\\/g, "/").split("/");
  return folder === vaultName ? { path: rest.join("/") } : { folder, path: rest.join("/") };
}

// Every note keeps its path while their content shrinks together until the whole JSON fits the budget.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/734
function serialize(notes: readonly FileResult[], note: string | undefined): string {
  let contentCap = Math.floor(OUTPUT_BUDGET_BYTES / Math.max(notes.length, 1));
  let text: string;
  do {
    const results = notes.map((note) => ({ ...note, content: note.content.slice(0, contentCap) }));
    text = JSON.stringify({ results, count: results.length, ...(note ? { note } : {}) });
    contentCap = Math.floor(contentCap * 0.8);
  } while (new TextEncoder().encode(text).length > OUTPUT_BUDGET_BYTES && contentCap > 0);
  return text;
}
