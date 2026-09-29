import { Document, parseDocument, YAMLMap, isMap, isScalar, Scalar } from "yaml";
import type { BackendId } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
const NAME_REPAIR_MESSAGE = "Use the same lowercase, hyphenated name in the file and folder.";

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
  doc: Document.Parsed;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents: BackendId[];
}

function splitFrontmatter(content: string): { yaml: string; body: string } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    throw new SkillFormatError(
      "SKILL.md must begin with a YAML frontmatter block delimited by ---"
    );
  }
  return { yaml: m[1] ?? "", body: m[2] ?? "" };
}

export class SkillFormatError extends Error {
  constructor(
    message: string,
    readonly offendingText?: string
  ) {
    super(message);
    this.name = "SkillFormatError";
  }
}

function yamlFormatError(
  yaml: string,
  error: { code: string; message: string; linePos?: readonly { line: number }[] }
): SkillFormatError {
  const errorLine = error.linePos?.[0]?.line;
  const offendingText = errorLine === undefined ? undefined : yaml.split(/\r?\n/)[errorLine - 1];

  // YAML reads `: ` in an unquoted description as a nested mapping; name the quoting repair
  // instead of the parser term. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  if (error.code === "BLOCK_AS_IMPLICIT_KEY") {
    const descriptionLine = /^(description[ \t]*:[ \t]*([^'"\r\n]*: [^\r\n]*))$/.exec(
      offendingText ?? ""
    );
    if (descriptionLine?.[1] !== undefined && descriptionLine[2] !== undefined) {
      return new SkillFormatError(
        'The description contains ": " and must be quoted.',
        descriptionLine[1]
      );
    }
  }

  return new SkillFormatError(
    `SKILL.md frontmatter YAML is invalid: ${error.message}`,
    offendingText
  );
}

function frontmatterLine(doc: Document.Parsed, yaml: string, key: string): string | undefined {
  if (!isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find((item) => isScalar(item.key) && item.key.value === key);
  const keyOffset = pair?.key?.range?.[0];
  if (keyOffset === undefined) return undefined;

  const lineStart = yaml.lastIndexOf("\n", keyOffset - 1) + 1;
  const nextLine = yaml.indexOf("\n", keyOffset);
  const lineEnd = nextLine === -1 ? yaml.length : nextLine;
  return yaml.slice(lineStart, lineEnd).replace(/\r$/, "");
}

function readString(doc: Document.Parsed, key: string): string | undefined {
  const v = doc.get(key);
  return typeof v === "string" ? v : undefined;
}

function readBoolean(doc: Document.Parsed, key: string): boolean | undefined {
  const v = doc.get(key);
  return typeof v === "boolean" ? v : undefined;
}

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

export function parseSkillFile(content: string, parentDirName: string): ParsedSkillFile {
  const { yaml, body } = splitFrontmatter(content);
  const doc = parseDocument(yaml, { keepSourceTokens: true });

  if (doc.errors.length > 0) {
    throw yamlFormatError(yaml, doc.errors[0]);
  }
  if (!isMap(doc.contents)) {
    throw new SkillFormatError("SKILL.md frontmatter must be a YAML mapping");
  }

  const name = readString(doc, "name");
  if (name === undefined) {
    if (doc.has("name")) {
      throw new SkillFormatError(
        "Skill `name` must be a string",
        frontmatterLine(doc, yaml, "name")
      );
    }
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `name`");
  }
  validateName(name, parentDirName, frontmatterLine(doc, yaml, "name"));

  const description = readString(doc, "description");
  if (description === undefined) {
    if (doc.has("description")) {
      throw new SkillFormatError(
        "Skill `description` must be a string",
        frontmatterLine(doc, yaml, "description")
      );
    }
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `description`");
  }
  validateDescription(description, frontmatterLine(doc, yaml, "description"));

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

export function validateName(name: string, parentDirName: string, offendingText?: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new SkillFormatError("Skill `name` must be a non-empty string", offendingText);
  }
  if (name.length > NAME_MAX) {
    throw new SkillFormatError(
      `Skill \`name\` must be at most ${NAME_MAX} characters (got ${name.length})`,
      offendingText
    );
  }
  if (!NAME_RE.test(name)) {
    throw new SkillFormatError(NAME_REPAIR_MESSAGE, offendingText);
  }
  if (name !== parentDirName) {
    throw new SkillFormatError(NAME_REPAIR_MESSAGE, offendingText);
  }
}

export function validateDescription(description: string, offendingText?: string): void {
  if (typeof description !== "string" || description.length === 0) {
    throw new SkillFormatError("Skill `description` must be a non-empty string", offendingText);
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new SkillFormatError(
      `Skill \`description\` must be at most ${DESCRIPTION_MAX} characters (got ${description.length})`,
      offendingText
    );
  }
}

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

function setOrDelete(doc: Document.Parsed, key: string, value: string | boolean | undefined): void {
  if (value === undefined) {
    if (doc.has(key)) doc.delete(key);
  } else {
    doc.set(key, value);
  }
}

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

function setEnabledAgents(doc: Document.Parsed, agents: BackendId[]): void {
  let metadata = doc.get("metadata");
  if (!isMap(metadata)) {
    metadata = new YAMLMap();
    doc.set("metadata", metadata);
  }
  const map = metadata as YAMLMap;
  const value = agents.join(",");
  const scalar = new Scalar(value);
  const existing = map.get("copilot-enabled-agents", true);
  if (isScalar(existing)) {
    scalar.type = existing.type ?? scalar.type;
  } else if (value.length === 0) {
    scalar.type = "QUOTE_DOUBLE";
  }
  map.set("copilot-enabled-agents", scalar);
}
