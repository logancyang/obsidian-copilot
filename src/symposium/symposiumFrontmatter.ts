import { SYMPOSIUM_DOC_ID_PATTERN } from "@/symposium/constants";
import type { SymposiumReceipt } from "@/symposium/types";
import { App, parseYaml, TFile } from "obsidian";

const SYMPOSIUM_PROPERTY = "symposium";

/**
 * Signals that a note already uses the reserved Symposium property for unrelated metadata.
 */
export class SymposiumPropertyConflictError extends Error {
  constructor() {
    super(
      "This note already uses the symposium property for an unrecognized value. Recover its public link from .symposium/publish-history.md, then repair or remove the property before publishing."
    );
    this.name = "SymposiumPropertyConflictError";
    Object.setPrototypeOf(this, SymposiumPropertyConflictError.prototype);
  }
}

/**
 * Signals that a note's frontmatter cannot be parsed safely enough to inspect its identity.
 */
export class SymposiumFrontmatterParseError extends Error {
  constructor() {
    super(
      "This note's frontmatter must be a YAML property map. Fix it before publishing to Symposium."
    );
    this.name = "SymposiumFrontmatterParseError";
    Object.setPrototypeOf(this, SymposiumFrontmatterParseError.prototype);
  }
}

/**
 * Returns the document id from a valid Symposium public link.
 * Throws when the reserved property is occupied by unrelated metadata so callers cannot overwrite it.
 *
 * @param value The raw frontmatter property value.
 */
export function parseSymposiumDocId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const docId = url.pathname.match(/^\/d\/([^/]+)\/?$/)?.[1];
    return url.protocol === "https:" && docId && SYMPOSIUM_DOC_ID_PATTERN.test(docId)
      ? docId
      : null;
  } catch {
    return null;
  }
}

function isFrontmatterProperties(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new SymposiumFrontmatterParseError();
  }
  if (frontmatter === null || frontmatter === undefined) {
    return null;
  }
  if (!isFrontmatterProperties(frontmatter)) {
    throw new SymposiumFrontmatterParseError();
  }
  if (!Object.prototype.hasOwnProperty.call(frontmatter, SYMPOSIUM_PROPERTY)) {
    return null;
  }
  const docId = parseSymposiumDocId(frontmatter[SYMPOSIUM_PROPERTY]);
  if (!docId) {
    throw new SymposiumPropertyConflictError();
  }
  return docId;
}

/**
 * Saves a server-issued Symposium link without replacing unrelated frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be saved.
 * @param receipt The validated publication receipt returned by Symposium.
 */
export async function saveSymposiumLink(
  app: App,
  file: TFile,
  receipt: SymposiumReceipt
): Promise<boolean> {
  if (parseSymposiumDocId(receipt.url) !== receipt.docId) {
    throw new Error("Cannot save an invalid Symposium document link.");
  }

  let saved = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
    if (!isFrontmatterProperties(frontmatter)) {
      throw new SymposiumFrontmatterParseError();
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, SYMPOSIUM_PROPERTY)) {
      saved = parseSymposiumDocId(frontmatter[SYMPOSIUM_PROPERTY]) === receipt.docId;
      return;
    }
    frontmatter[SYMPOSIUM_PROPERTY] = receipt.url;
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
  await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
    if (!isFrontmatterProperties(frontmatter)) {
      throw new SymposiumFrontmatterParseError();
    }
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
