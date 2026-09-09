import { OPENARTIFACTS_DOC_ID_PATTERN } from "@/openArtifacts/constants";
import type { OpenArtifactsReceipt } from "@/openArtifacts/types";
import { App, parseYaml, TFile } from "obsidian";

const OPENARTIFACTS_PROPERTY = "openartifacts";
// Notes published before the rename hold their identity here. It is read as a fallback and
// replaced by `openartifacts` on the next successful publish, so nothing is stranded.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/395
const LEGACY_PROPERTY = "symposium";

/**
 * Signals that a note already uses the reserved OpenArtifacts property for unrelated metadata.
 */
export class OpenArtifactsPropertyConflictError extends Error {
  constructor() {
    super(
      "This note's openartifacts property (or its legacy symposium property) holds a value that is not this note's OpenArtifacts link. Recover the public link from .openartifacts/publish-history.md, then repair or remove the property before publishing."
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

const hasProperty = (frontmatter: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(frontmatter, key);

/**
 * The identity a property map holds, honouring the current key first and the legacy key as a
 * fallback. Two keys naming different documents, or either key holding anything but a link,
 * is a conflict the caller must not resolve silently.
 */
function identityFrom(frontmatter: Record<string, unknown>): string | null {
  const keys = [OPENARTIFACTS_PROPERTY, LEGACY_PROPERTY].filter((key) =>
    hasProperty(frontmatter, key)
  );
  if (keys.length === 0) return null;
  const ids: Array<string | null> = keys.map((key) => parseOpenArtifactsDocId(frontmatter[key]));
  const [first] = ids;
  if (!first || ids.some((id) => id !== first)) {
    throw new OpenArtifactsPropertyConflictError();
  }
  return first;
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
  return identityFrom(frontmatter);
}

/**
 * Saves a server-issued OpenArtifacts link without replacing unrelated frontmatter. A legacy
 * `symposium` key naming the same document is dropped, which completes its migration.
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
    const legacyDocId = hasProperty(frontmatter, LEGACY_PROPERTY)
      ? parseOpenArtifactsDocId(frontmatter[LEGACY_PROPERTY])
      : undefined;
    if (hasProperty(frontmatter, OPENARTIFACTS_PROPERTY)) {
      saved = parseOpenArtifactsDocId(frontmatter[OPENARTIFACTS_PROPERTY]) === receipt.docId;
    } else if (legacyDocId === undefined || legacyDocId === receipt.docId) {
      frontmatter[OPENARTIFACTS_PROPERTY] = receipt.url;
      saved = true;
    }
    if (saved && legacyDocId === receipt.docId) delete frontmatter[LEGACY_PROPERTY];
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
    removed = true;
    for (const key of [OPENARTIFACTS_PROPERTY, LEGACY_PROPERTY]) {
      if (!hasProperty(frontmatter, key)) continue;
      if (parseOpenArtifactsDocId(frontmatter[key]) === expectedDocId) delete frontmatter[key];
      else removed = false;
    }
  });
  return removed;
}
