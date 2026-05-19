import { Document, parseDocument, YAMLMap, isMap, isScalar, Scalar } from "yaml";
import type { BackendId } from "./types";

/**
 * Strict frontmatter regex used by `splitFrontmatter`. Requires the file
 * to begin with `---` on its own line and end the frontmatter with `---`
 * on its own line. CRLF tolerated. Body may be empty.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** Spec rule: lowercase a–z / 0–9 / hyphens; no leading/trailing/consecutive hyphens; 1–64 chars. */
export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;

/**
 * Result of parsing a SKILL.md file. The Document is preserved so
 * `serializeSkillFile` can round-trip unknown keys byte-equal.
 */
export interface ParsedSkillFile {
  /** The validated and conveniently-typed frontmatter view. */
  frontmatter: SkillFrontmatter;
  /** Markdown body after the closing `---`. */
  body: string;
  /**
   * The underlying YAML Document. Carries comments, ordering, and
   * unknown keys (top-level and inside `metadata`). Mutate via
   * `applyFrontmatterChanges` if you need to edit; otherwise leave it
   * alone and re-serialize as-is.
   */
  doc: Document.Parsed;
}

/** Typed view over the SKILL.md frontmatter. Optional fields stay `undefined` when absent. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** Space-separated string as it appears in frontmatter. Not split. */
  allowedTools?: string;
  /** Claude Code-only top-level field. */
  model?: string;
  /** Claude Code-only top-level field. */
  disableModelInvocation?: boolean;
  /** Claude Code-only top-level field (kebab-case `user-invocable`). */
  userInvocable?: boolean;
  /** Sourced from `metadata.copilot-enabled-agents`. Empty string in the file → empty array. */
  enabledAgents: BackendId[];
}

/**
 * Split `---\n…\n---\n<body>` into the YAML chunk and the body.
 * Throws when the frontmatter block is missing or malformed.
 */
function splitFrontmatter(content: string): { yaml: string; body: string } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    throw new SkillFormatError(
      "SKILL.md must begin with a YAML frontmatter block delimited by ---"
    );
  }
  return { yaml: m[1] ?? "", body: m[2] ?? "" };
}

/** Domain error type — carries a human-readable message suitable for surfacing in the Skills tab. */
export class SkillFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillFormatError";
  }
}

/** Read a top-level string scalar from a YAML Document, or return undefined. */
function readString(doc: Document.Parsed, key: string): string | undefined {
  const v = doc.get(key);
  return typeof v === "string" ? v : undefined;
}

/** Read a top-level boolean scalar from a YAML Document, or return undefined. */
function readBoolean(doc: Document.Parsed, key: string): boolean | undefined {
  const v = doc.get(key);
  return typeof v === "boolean" ? v : undefined;
}

/** Read `metadata.copilot-enabled-agents` as a comma-separated string → trimmed BackendId list. */
function readEnabledAgents(doc: Document.Parsed): BackendId[] {
  const metadata = doc.get("metadata");
  if (!isMap(metadata)) return [];
  const raw = metadata.get("copilot-enabled-agents");
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Parse a SKILL.md file's text content and validate against the spec.
 *
 * @param content Full file contents (frontmatter + body).
 * @param parentDirName The on-disk parent directory's basename. The spec
 *   requires this to match `frontmatter.name` exactly — pass it in
 *   rather than re-reading the FS so this function stays a pure leaf
 *   module (see AGENTS.md "Avoiding Deep Dependency Chains in Tests").
 * @returns Parsed + validated representation suitable for round-tripping.
 * @throws SkillFormatError when validation fails.
 */
export function parseSkillFile(content: string, parentDirName: string): ParsedSkillFile {
  const { yaml, body } = splitFrontmatter(content);
  const doc = parseDocument(yaml, { keepSourceTokens: true });

  if (doc.errors.length > 0) {
    throw new SkillFormatError(`SKILL.md frontmatter YAML is invalid: ${doc.errors[0].message}`);
  }
  if (!isMap(doc.contents)) {
    throw new SkillFormatError("SKILL.md frontmatter must be a YAML mapping");
  }

  const name = readString(doc, "name");
  if (!name) {
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `name`");
  }
  validateName(name, parentDirName);

  const description = readString(doc, "description");
  if (description === undefined) {
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `description`");
  }
  validateDescription(description);

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    license: readString(doc, "license"),
    compatibility: readString(doc, "compatibility"),
    allowedTools: readString(doc, "allowed-tools"),
    model: readString(doc, "model"),
    disableModelInvocation: readBoolean(doc, "disable-model-invocation"),
    userInvocable: readBoolean(doc, "user-invocable"),
    enabledAgents: readEnabledAgents(doc),
  };

  return { frontmatter, body, doc };
}

/**
 * Validate a skill `name` against the agentskills.io spec rules plus
 * the parent-directory-match requirement.
 *
 * @throws SkillFormatError with a descriptive message.
 */
export function validateName(name: string, parentDirName: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new SkillFormatError("Skill `name` must be a non-empty string");
  }
  if (name.length > NAME_MAX) {
    throw new SkillFormatError(
      `Skill \`name\` must be at most ${NAME_MAX} characters (got ${name.length})`
    );
  }
  if (!NAME_RE.test(name)) {
    throw new SkillFormatError(
      `Skill \`name\` must be lowercase a–z, 0–9, and hyphens with no leading, trailing, or consecutive hyphens (got "${name}")`
    );
  }
  if (name !== parentDirName) {
    throw new SkillFormatError(
      `Skill \`name\` ("${name}") must match the parent directory name ("${parentDirName}")`
    );
  }
}

/**
 * Validate a skill `description` against the spec — non-empty and
 * ≤1024 characters.
 *
 * @throws SkillFormatError when invalid.
 */
export function validateDescription(description: string): void {
  if (typeof description !== "string" || description.length === 0) {
    throw new SkillFormatError("Skill `description` must be a non-empty string");
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new SkillFormatError(
      `Skill \`description\` must be at most ${DESCRIPTION_MAX} characters (got ${description.length})`
    );
  }
}

/**
 * Partial frontmatter mutation for `serializeSkillFile`. Pass only the
 * keys you want to update; unspecified keys keep their existing on-disk
 * value (and ordering). `enabledAgents`, if provided, replaces the
 * value at `metadata.copilot-enabled-agents`; other `metadata.*` keys
 * are left untouched.
 */
export interface SkillFrontmatterPatch {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents?: BackendId[];
}

/** Set a value on the doc, or remove the key if the value is `undefined`. */
function setOrDelete(doc: Document.Parsed, key: string, value: string | boolean | undefined): void {
  if (value === undefined) {
    if (doc.has(key)) doc.delete(key);
  } else {
    doc.set(key, value);
  }
}

/**
 * Re-serialize a parsed SKILL.md back to disk text, optionally applying
 * a patch. Unknown top-level keys and unknown `metadata.*` keys are
 * preserved byte-equal (the YAML Document carries them); known keys
 * are updated in place to preserve ordering.
 */
export function serializeSkillFile(
  parsed: ParsedSkillFile,
  patch: SkillFrontmatterPatch = {}
): string {
  const { doc, body } = parsed;

  if ("name" in patch) setOrDelete(doc, "name", patch.name);
  if ("description" in patch) setOrDelete(doc, "description", patch.description);
  if ("license" in patch) setOrDelete(doc, "license", patch.license);
  if ("compatibility" in patch) setOrDelete(doc, "compatibility", patch.compatibility);
  if ("allowedTools" in patch) setOrDelete(doc, "allowed-tools", patch.allowedTools);
  if ("model" in patch) setOrDelete(doc, "model", patch.model);
  if ("disableModelInvocation" in patch)
    setOrDelete(doc, "disable-model-invocation", patch.disableModelInvocation);
  if ("userInvocable" in patch) setOrDelete(doc, "user-invocable", patch.userInvocable);

  if (patch.enabledAgents !== undefined) {
    setEnabledAgents(doc, patch.enabledAgents);
  }

  const yamlText = doc.toString().replace(/\n+$/, "");
  return `---\n${yamlText}\n---\n${body}`;
}

/**
 * Update `metadata.copilot-enabled-agents` to the given list, creating
 * the `metadata` map if absent. Preserves every other `metadata.*` key.
 */
function setEnabledAgents(doc: Document.Parsed, agents: BackendId[]): void {
  let metadata = doc.get("metadata");
  if (!isMap(metadata)) {
    metadata = new YAMLMap();
    doc.set("metadata", metadata);
  }
  const map = metadata as YAMLMap;
  const value = agents.join(",");
  // Use a string scalar so empty values still emit `""` rather than `null`.
  const scalar = new Scalar(value);
  // Preserve existing quoting style when present.
  const existing = map.get("copilot-enabled-agents", true);
  if (isScalar(existing)) {
    scalar.type = existing.type ?? scalar.type;
  } else if (value.length === 0) {
    scalar.type = "QUOTE_DOUBLE";
  }
  map.set("copilot-enabled-agents", scalar);
}
