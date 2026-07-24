import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import type CopilotPlugin from "@/main";
import type { PiNote, PiSearchHit, PiToolContext } from "@/pi/tools";
import { TFile } from "obsidian";

/** How many search hits the model is given before it has to narrow the query. */
const MAX_SEARCH_HITS = 10;

/** How much of a hit's body is quoted as its excerpt. */
const EXCERPT_CHARS = 500;

/** See AGENTS.md → "Referential stability". */
const NO_HITS: readonly PiSearchHit[] = Object.freeze([]);

function excerpt(content: unknown): string {
  const text = typeof content === "string" ? content : "";
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

/** Read a metadata field the search pipeline types as `unknown`. */
function metadataString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Bind the read-only pi tools to this vault. Each method is the thinnest
 * possible bridge to something the plugin already owns — the vault adapter,
 * the existing search pipeline, and the Plus web-search relay — so the tool
 * definitions themselves stay platform-neutral and testable.
 *
 * @param plugin the plugin instance owning the vault and the search pipeline
 */
export function createPiToolContext(plugin: CopilotPlugin): PiToolContext {
  const readFile = async (file: TFile): Promise<PiNote> => ({
    path: file.path,
    content: await plugin.app.vault.cachedRead(file),
  });

  return {
    readActiveNote: async () => {
      const file = plugin.app.workspace.getActiveFile();
      return file ? readFile(file) : null;
    },

    readNote: async (path: string) => {
      const file = plugin.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? readFile(file) : null;
    },

    searchVault: async (query: string) => {
      const docs = await plugin.customSearchDB(query, [query], 0.5);
      const hits = docs.slice(0, MAX_SEARCH_HITS).map((doc) => ({
        path: metadataString(doc.metadata.path) || metadataString(doc.metadata.title),
        excerpt: excerpt(doc.content),
      }));
      return hits.length > 0 ? hits : NO_HITS;
    },

    webSearch: async (query: string) => {
      const result = await BrevilabsClient.getInstance().webSearch(query);
      const answer = result.response.choices[0]?.message.content ?? "";
      const citations = result.response.citations;
      return citations.length > 0 ? `${answer}\n\nSources:\n${citations.join("\n")}` : answer;
    },
  };
}
