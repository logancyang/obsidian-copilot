import { logWarn } from "@/logger";
import { MiyoRequestError, type MiyoClient, type MiyoSearchResult } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl } from "@/miyo/miyoRuntimePolicy";
import type { CopilotSettings } from "@/settings/model";
import { err2String } from "@/utils";

export const MIYO_SEARCH_TOOL_NAME = "miyo_search";

const RESULT_LIMIT = 10;
const MAX_VARIANTS = 2;

export const MIYO_SEARCH_TOOL = Object.freeze({
  name: MIYO_SEARCH_TOOL_NAME,
  description: `Semantic search over the user's notes through Miyo: finds notes by meaning, not only exact words. Searches the active vault plus any extra Miyo folders the user enabled in Copilot settings. Returns up to ${RESULT_LIMIT} notes as { path, content }.`,
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
      "Miyo search could not enforce Current vault scope because the active vault identity is missing. Do not retry or run an unrestricted search."
    );
  }
  // Ticked folders widen only Current vault scope.
  // https://github.com/logancyang/obsidian-copilot/issues/3508
  const extraFolders = unrestricted
    ? []
    : settings.miyoExtraSearchFolders.filter((name) => name !== vaultName);

  try {
    const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
    const search = (folders: readonly string[]) =>
      client.search(baseUrl, unrestricted ? undefined : vaultName, query, RESULT_LIMIT, {
        variants,
        // folder_name stays the vault, so a Miyo without multi-folder search still searches only the vault.
        // https://github.com/logancyang/obsidian-copilot/issues/3508
        folderNames: folders.length > 0 ? [vaultName, ...folders] : undefined,
      });

    let note: string | undefined;
    let response;
    try {
      response = await search(extraFolders);
    } catch (error) {
      const missing =
        error instanceof MiyoRequestError && error.status === 404
          ? /^Folder not registered: (.+)$/.exec(error.detail)?.[1]
          : undefined;
      // A ticked folder this Miyo lacks, such as one synced from another device, fails the whole search.
      // https://github.com/logancyang/obsidian-copilot/issues/3508
      if (missing === undefined || !extraFolders.includes(missing)) throw error;
      note = `Miyo has no folder "${missing}" that is ticked in Copilot settings, so only the active vault was searched.`;
      response = await search([]);
    }

    const results = toFileResults(response.results ?? []);
    return {
      text: JSON.stringify({ results, count: results.length, ...(note ? { note } : {}) }),
      isError: false,
    };
  } catch (error) {
    const details = err2String(error);
    logWarn(`[MiyoSearchTool] search failed: ${details}`);
    return failure(
      `Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: ${details}`
    );
  }
}

function failure(text: string): MiyoSearchToolResult {
  return { text, isError: true };
}

// Mirrors the grouping `miyo search --json` prints: one entry per file in Miyo's ranking, with each file's excerpts in note order.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/734
function toFileResults(chunks: readonly MiyoSearchResult[]): FileResult[] {
  const excerptsByPath = new Map<string, { index: number; text: string }[]>();
  for (const { path, chunk_index, chunk_text } of chunks) {
    const text = (chunk_text ?? "").replace(/^[\s\S]*?NOTE BLOCK CONTENT:/, "").trim();
    const excerpts = excerptsByPath.get(path) ?? [];
    if (text) excerpts.push({ index: chunk_index ?? 0, text });
    excerptsByPath.set(path, excerpts);
  }
  return [...excerptsByPath].slice(0, RESULT_LIMIT).map(([path, excerpts]) => ({
    path,
    content: excerpts
      .sort((a, b) => a.index - b.index)
      .map(({ text }) => `NOTE BLOCK CONTENT:\n${text}`)
      .join("\n\n"),
  }));
}
