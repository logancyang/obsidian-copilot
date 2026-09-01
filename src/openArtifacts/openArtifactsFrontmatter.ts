import { OPENARTIFACTS_DOC_ID_PATTERN } from "@/openArtifacts/constants";
import type { OpenArtifactsReceipt } from "@/openArtifacts/types";
import { App, parseYaml, TFile } from "obsidian";

// Existing notes persist their publishing identity under `symposium`; changing the key would
// strand their remote documents.
const OPENARTIFACTS_PROPERTY = "symposium";

/**
 * Signals that a note already uses the reserved OpenArtifacts property for unrelated metadata.
 */
export class OpenArtifactsPropertyConflictError extends Error {
  constructor() {
    super(
      "This note already uses the symposium property for an unrecognized value. Recover its public link from .openartifacts/publish-history.md, then repair or remove the property before publishing."
    );
    this.name = "OpenArtifactsPropertyConflictError";
    Object.setPrototypeOf(this, OpenArtifactsPropertyConflictError.prototype);
  }
}

/**
 * Signals that a note's frontmatter cannot be parsed safely enough to inspect its identity.
 */
export class OpenArtifactsFrontmatterParseError extends Error {
  constructor() {
    super(
      "This note's frontmatter must be a YAML property map. Fix it before publishing to OpenArtifacts."
    );
    this.name = "OpenArtifactsFrontmatterParseError";
    Object.setPrototypeOf(this, OpenArtifactsFrontmatterParseError.prototype);
  }
}

/**
 * Returns the document id from a valid OpenArtifacts public link.
 * Throws when the reserved property is occupied by unrelated metadata so callers cannot overwrite it.
 *
 * @param value The raw frontmatter property value.
 */
export function parseOpenArtifactsDocId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const docId = url.pathname.match(/^\/d\/([^/]+)\/?$/)?.[1];
    // Only the document id is sent to the API, so any https host that ever issued a
    // receipt (the retired symposium.site included) stays a valid identity.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
    return url.protocol === "https:" && docId && OPENARTIFACTS_DOC_ID_PATTERN.test(docId)
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
 * Reads the current valid OpenArtifacts identity from the note itself.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be read.
 */
export async function getOpenArtifactsDocId(app: App, file: TFile): Promise<string | null> {
  const markdown = (await app.vault.read(file)).replace(/^\uFEFF/, "");
  const yaml = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (yaml === undefined) {
    return null;
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(yaml);
  } catch {
    throw new OpenArtifactsFrontmatterParseError();
  }
  if (frontmatter === null || frontmatter === undefined) {
    return null;
  }
  if (!isFrontmatterProperties(frontmatter)) {
    throw new OpenArtifactsFrontmatterParseError();
  }
  if (!Object.prototype.hasOwnProperty.call(frontmatter, OPENARTIFACTS_PROPERTY)) {
    return null;
  }
  const docId = parseOpenArtifactsDocId(frontmatter[OPENARTIFACTS_PROPERTY]);
  if (!docId) {
    throw new OpenArtifactsPropertyConflictError();
  }
  return docId;
}

/**
 * Saves a server-issued OpenArtifacts link without replacing unrelated frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note whose publication identity should be saved.
 * @param receipt The validated publication receipt returned by OpenArtifacts.
 */
export async function saveOpenArtifactsLink(
  app: App,
  file: TFile,
  receipt: OpenArtifactsReceipt
): Promise<boolean> {
  if (parseOpenArtifactsDocId(receipt.url) !== receipt.docId) {
    throw new Error("Cannot save an invalid OpenArtifacts document link.");
  }

  let saved = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
    if (!isFrontmatterProperties(frontmatter)) {
      throw new OpenArtifactsFrontmatterParseError();
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, OPENARTIFACTS_PROPERTY)) {
      saved = parseOpenArtifactsDocId(frontmatter[OPENARTIFACTS_PROPERTY]) === receipt.docId;
      return;
    }
    frontmatter[OPENARTIFACTS_PROPERTY] = receipt.url;
    saved = true;
  });
  return saved;
}

/**
 * Removes the local OpenArtifacts identity without changing other frontmatter.
 *
 * @param app The Obsidian application that owns the note.
 * @param file The note that should return to an unpublished state.
 * @param expectedDocId The identity whose remote document was deleted.
 */
export async function removeOpenArtifactsDocId(
  app: App,
  file: TFile,
  expectedDocId: string
): Promise<boolean> {
  let removed = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
    if (!isFrontmatterProperties(frontmatter)) {
      throw new OpenArtifactsFrontmatterParseError();
    }
    if (!Object.prototype.hasOwnProperty.call(frontmatter, OPENARTIFACTS_PROPERTY)) {
      removed = true;
      return;
    }
    const currentDocId = parseOpenArtifactsDocId(frontmatter[OPENARTIFACTS_PROPERTY]);
    if (currentDocId !== expectedDocId) {
      return;
    }
    delete frontmatter[OPENARTIFACTS_PROPERTY];
    removed = true;
  });
  return removed;
}
