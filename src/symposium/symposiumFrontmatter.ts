import { SYMPOSIUM_DOC_ID_PATTERN } from "@/symposium/constants";
import { App, parseYaml, TFile } from "obsidian";

const SYMPOSIUM_PROPERTY = "symposium";

/**
 * Signals that a note already uses the reserved Symposium property for unrelated metadata.
 */
export class SymposiumPropertyConflictError extends Error {
  constructor() {
    super(
      "This note already uses the symposium property for an unrecognized value. Rename or remove that property before publishing."
    );
    this.name = "SymposiumPropertyConflictError";
    Object.setPrototypeOf(this, SymposiumPropertyConflictError.prototype);
  }
}

/**
 * Returns a Symposium identity only when the frontmatter value matches the server's id format.
 * Throws when the reserved property is occupied by unrelated metadata so callers cannot overwrite it.
 *
 * @param value The raw frontmatter property value.
 */
export function parseSymposiumDocId(value: unknown): string | null {
  return typeof value === "string" && SYMPOSIUM_DOC_ID_PATTERN.test(value) ? value : null;
}

/**
 * Reads the current valid Symposium identity from the note itself.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be read.
 */
export async function getSymposiumDocId(app: App, file: TFile): Promise<string | null> {
  const markdown = (await app.vault.read(file)).replace(/^\uFEFF/, "");
  const yaml = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (yaml === undefined) {
    return null;
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(yaml);
  } catch {
    return null;
  }
  if (!frontmatter || typeof frontmatter !== "object") {
    return null;
  }
  const properties = frontmatter as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(properties, SYMPOSIUM_PROPERTY)) {
    return null;
  }
  const docId = parseSymposiumDocId(properties[SYMPOSIUM_PROPERTY]);
  if (!docId) {
    throw new SymposiumPropertyConflictError();
  }
  return docId;
}

/**
 * Saves a server-issued Symposium identity without replacing unrelated frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be saved.
 * @param docId The validated identity returned by Symposium.
 * @param expectedDocId The identity that was current when the remote action began.
 */
export async function saveSymposiumDocId(
  app: App,
  file: TFile,
  docId: string,
  expectedDocId: string | null
): Promise<boolean> {
  if (!SYMPOSIUM_DOC_ID_PATTERN.test(docId)) {
    throw new Error("Cannot save an invalid Symposium document id.");
  }

  let saved = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const currentDocId = parseSymposiumDocId(frontmatter[SYMPOSIUM_PROPERTY]);
    if (Object.prototype.hasOwnProperty.call(frontmatter, SYMPOSIUM_PROPERTY) && !currentDocId) {
      return;
    }
    if (currentDocId === docId) {
      saved = true;
      return;
    }
    if (currentDocId !== expectedDocId) {
      return;
    }
    frontmatter[SYMPOSIUM_PROPERTY] = docId;
    saved = true;
  });
  return saved;
}

/**
 * Removes the local Symposium identity without changing other frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note that should return to an unpublished state.
 * @param expectedDocId The identity whose remote document was deleted.
 */
export async function removeSymposiumDocId(
  app: App,
  file: TFile,
  expectedDocId: string
): Promise<boolean> {
  let removed = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, SYMPOSIUM_PROPERTY)) {
      removed = true;
      return;
    }
    const currentDocId = parseSymposiumDocId(frontmatter[SYMPOSIUM_PROPERTY]);
    if (currentDocId !== expectedDocId) {
      return;
    }
    delete frontmatter[SYMPOSIUM_PROPERTY];
    removed = true;
  });
  return removed;
}
