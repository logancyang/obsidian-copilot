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
  description: `Semantic search over the user's notes: finds notes by meaning, not only exact words. Searches the active vault plus the extra Miyo folders enabled in Copilot settings. Returns up to ${NOTE_LIMIT} notes as { path, content }.`,
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
  // Only the explicit Unrestricted setting may drop the folder boundary; a missing identity never widens the search.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
  if (!unrestricted && !vaultName) {
    return failure(
      "The active vault identity is missing, so Current vault scope can't be enforced. Do not retry or search unrestricted."
    );
  }
  // Ticked folders widen only Current vault scope.
  // https://github.com/logancyang/obsidian-copilot/issues/3508
  const extraFolders = unrestricted
    ? []
    : settings.miyoExtraSearchFolders.filter((name) => name !== vaultName);

  try {
    const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
    const searched = await searchWithoutMissingFolders(
      (folders) =>
        client.search(
          baseUrl,
          unrestricted ? undefined : vaultName,
          query,
          MIYO_SEARCH_CANDIDATE_LIMIT,
          {
            variants,
            // folder_name stays the vault, so a Miyo without multi-folder search still searches only the vault.
            // https://github.com/logancyang/obsidian-copilot/issues/3508
            folderNames: folders.length > 0 ? [vaultName, ...folders] : undefined,
          }
        ),
      extraFolders
    );
    const skipped = extraFolders.filter((name) => !searched.extraFolders.includes(name));
    return {
      text: serialize(
        toNotes(searched.response.results ?? []),
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
function toNotes(chunks: readonly MiyoSearchResult[]): FileResult[] {
  const excerptsByPath = new Map<string, string[]>();
  for (const { path, chunk_text } of chunks) {
    const text = (chunk_text ?? "").replace(/^[\s\S]*?NOTE BLOCK CONTENT:/, "").trim();
    excerptsByPath.set(path, [...(excerptsByPath.get(path) ?? []), ...(text ? [text] : [])]);
  }
  return [...excerptsByPath]
    .slice(0, NOTE_LIMIT)
    .map(([path, excerpts]) => ({ path, content: excerpts.join("\n\n") }));
}

// Every note keeps its path while their content shrinks together until the whole JSON fits the budget.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/734
function serialize(notes: readonly FileResult[], note: string | undefined): string {
  let contentCap = Math.floor(OUTPUT_BUDGET_BYTES / notes.length);
  let text: string;
  do {
    const results = notes.map(({ path, content }) => ({
      path,
      content: content.slice(0, contentCap),
    }));
    text = JSON.stringify({ results, count: results.length, ...(note ? { note } : {}) });
    contentCap = Math.floor(contentCap * 0.8);
  } while (new TextEncoder().encode(text).length > OUTPUT_BUDGET_BYTES && contentCap > 0);
  return text;
}
