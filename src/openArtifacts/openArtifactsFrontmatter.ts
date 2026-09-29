import { OPENARTIFACTS_DOC_ID_PATTERN } from "@/openArtifacts/constants";
import type { OpenArtifactsReceipt } from "@/openArtifacts/types";
import { App, parseYaml, TFile } from "obsidian";

const OPENARTIFACTS_PROPERTY = "openartifacts";
// Notes published before the rename hold their identity here; read as a fallback.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/395
const LEGACY_PROPERTY = "symposium";

export class OpenArtifactsPropertyConflictError extends Error {
  constructor() {
    super(
      "This note's openartifacts property (or its legacy symposium property) holds a value that is not this note's OpenArtifacts link. Recover the public link from .openartifacts/publish-history.md, then repair or remove the property before publishing."
    );
    this.name = "OpenArtifactsPropertyConflictError";
    Object.setPrototypeOf(this, OpenArtifactsPropertyConflictError.prototype);
  }
}

export class OpenArtifactsFrontmatterParseError extends Error {
  constructor() {
    super(
      "This note's frontmatter must be a YAML property map. Fix it before publishing to OpenArtifacts."
    );
    this.name = "OpenArtifactsFrontmatterParseError";
    Object.setPrototypeOf(this, OpenArtifactsFrontmatterParseError.prototype);
  }
}

export function parseOpenArtifactsDocId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const docId = url.pathname.match(/^\/d\/([^/]+)\/?$/)?.[1];
    // Only the document id is sent to the API, so the retired symposium.site host stays valid.
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
