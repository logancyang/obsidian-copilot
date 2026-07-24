import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { activeNoteTool } from "./activeNote";
import { readNoteTool } from "./readNote";
import { searchVaultTool } from "./searchVault";
import { webSearchTool } from "./webSearch";

/** One note as the tools hand it to the model. */
export interface PiNote {
  path: string;
  content: string;
}

/** One vault search hit. `path` is what `read_note` accepts. */
export interface PiSearchHit {
  path: string;
  excerpt: string;
}

/**
 * Everything the tools need from the host, injected per turn so the engine
 * module never imports the vault, the plugin, or the Plus client directly.
 * Each method returns the plain data the tool formats for the model; failures
 * reject and the tool reports them back to the model as an error result.
 */
export interface PiToolContext {
  /** The note the user is looking at, or null when no note is open. */
  readActiveNote(): Promise<PiNote | null>;
  /** Read one note by vault path, or null when nothing matches. */
  readNote(path: string): Promise<PiNote | null>;
  /** Search the vault, best matches first. */
  searchVault(query: string): Promise<readonly PiSearchHit[]>;
  /** Search the web, returning an answer with its sources. */
  webSearch(query: string): Promise<string>;
}

/** A tool bound to {@link PiToolContext}. */
export type PiTool = AgentHarnessTool<PiToolContext>;

/**
 * The read-only tool surface. Ordered deliberately and never rebuilt from
 * dynamic state: the model sees a byte-identical tool block on every turn,
 * which is what lets the provider's prompt cache hit.
 */
export const PI_TOOLS: readonly PiTool[] = Object.freeze([
  activeNoteTool,
  readNoteTool,
  searchVaultTool,
  webSearchTool,
]);

export { activeNoteTool, readNoteTool, searchVaultTool, webSearchTool };
