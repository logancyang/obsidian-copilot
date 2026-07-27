import { SYMPOSIUM_DOC_ID_PATTERN } from "@/symposium/constants";
import { App, TFile } from "obsidian";

const SYMPOSIUM_PROPERTY = "symposium";

/**
 * Returns a Symposium identity only when the frontmatter value matches the server's id format.
 *
 * @param value The raw frontmatter property value.
 */
export function parseSymposiumDocId(value: unknown): string | null {
  return typeof value === "string" && SYMPOSIUM_DOC_ID_PATTERN.test(value) ? value : null;
}

/**
 * Reads the current valid Symposium identity from Obsidian's metadata cache.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be read.
 */
export function getSymposiumDocId(app: App, file: TFile): string | null {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return parseSymposiumDocId(frontmatter?.[SYMPOSIUM_PROPERTY]);
}

/**
 * Saves a server-issued Symposium identity without replacing unrelated frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be saved.
 * @param docId The validated identity returned by Symposium.
 */
export async function saveSymposiumDocId(app: App, file: TFile, docId: string): Promise<void> {
  if (!SYMPOSIUM_DOC_ID_PATTERN.test(docId)) {
    throw new Error("Cannot save an invalid Symposium document id.");
  }

  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    frontmatter[SYMPOSIUM_PROPERTY] = docId;
  });
}

/**
 * Removes the local Symposium identity without changing other frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note that should return to an unpublished state.
 */
export async function removeSymposiumDocId(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    delete frontmatter[SYMPOSIUM_PROPERTY];
  });
}
