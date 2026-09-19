import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import { App, CachedMetadata, parseFrontMatterAliases, TFile } from "obsidian";

const EXCERPT_CHARS = 1500;
const EVIDENCE_TITLES = 4;
const EVIDENCE_PATH_CHARS = 80;
const PROPERTY_VALUE_CHARS = 80;
const MAX_PROPERTIES = 20;
const MAX_LINKS = 10;
const MAX_NEIGHBOR_TAGS = 20;
const REQUEST_TOKEN_BUDGET = 28_000;
const REQUEST_BODY_BYTES = 256 * 1024;
const MAX_CANDIDATES = 600;
const EVIDENCE_TOKEN_MARGIN = 1.3;
const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
const HEX_COLOUR_TAG = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Provisional: 0.5 is the model's yes/no boundary. A version-2 hold-one-out measurement will
// set the final cutoff; keep the cap because noul remains a weak cutoff across notes.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/492
export const AUTO_ADD_MIN_NOUL = 0.5;
export const AUTO_ADD_MAX = 3;

export interface TagSuggestionState {
  title: string;
  path: string;
  folder: string;
  created: string;
  modified: string;
  existing_tags: string[];
  aliases?: string[];
  properties?: Record<string, FrontmatterValue>;
  links_out?: string[];
  links_in?: string[];
  neighbor_tags?: NeighborTag[];
  content?: string;
  headings?: string[];
  excerpt?: string;
  section_leads?: string[];
}

export interface TagCandidate {
  key: string;
  tag: string;
  count: number;
  firstUsed: string;
  lastUsed: string;
  sameFolder: number;
  sharedTags: number;
  examples: TagExample[];
  prior: number;
}

export interface TagExample {
  path: string;
  created: string;
}

export interface NeighborTag {
  tag: string;
  count: number;
}

type FrontmatterScalar = string | number | boolean | null;
type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[];

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export interface NoulAnswer {
  noul?: number;
}

export interface PackedTagSuggestionRequest {
  state: TagSuggestionState;
  questions: Record<string, NoulQuestion>;
  candidates: Record<string, TagCandidate>;
  estimatedTokens: number;
}

export interface RankedTagSuggestion {
  tag: string;
  score: number;
}

interface IndexedNote {
  path: string;
  folder: string;
  ctime: number;
  tags: Map<string, string>;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function formatLocalDate(timestamp: number, includeTime = false): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return includeTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

function isSensitiveFrontmatterKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "licensekey",
    "authorization",
    "credential",
    "privatekey",
    "passphrase",
  ].some((term) => normalized.includes(term));
}

function stripTagSuggestionFrontmatter(content: string): string {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n)/.exec(content);
  if (!opening) return content;
  const closingFence = /^---[ \t]*(?:\r\n|\n|$)/gm;
  closingFence.lastIndex = opening[0].length;
  const closing = closingFence.exec(content);
  if (!closing) return "";
  return content.slice(closing.index + closing[0].length).trimStart();
}

function frontmatterProperties(
  frontmatter: Record<string, unknown> | undefined
): Record<string, FrontmatterValue> {
  const properties: Record<string, FrontmatterValue> = {};
  const excluded = new Set(["tags", "tag", "aliases", "alias", "position"]);
  const scalar = (value: unknown): value is FrontmatterScalar =>
    value === null || ["string", "number", "boolean"].includes(typeof value);
  const clipped = (value: FrontmatterScalar): FrontmatterScalar =>
    typeof value === "string" ? clip(value, PROPERTY_VALUE_CHARS) : value;

  // The Jev proxy needs useful metadata, not Obsidian's structural fields or
  // unbounded nested YAML. https://github.com/Brevilabs/obsidian-copilot-private/issues/492
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (Object.keys(properties).length >= MAX_PROPERTIES) break;
    if (excluded.has(key) || isSensitiveFrontmatterKey(key)) continue;
    if (scalar(value)) {
      properties[key] = clipped(value);
    } else if (Array.isArray(value) && value.every(scalar)) {
      properties[key] = value.map(clipped);
    }
  }
  return properties;
}

function stringList(value: unknown, splitTags = false): string[] {
  const scalar = typeof value === "string";
  const values = Array.isArray(value) ? value : scalar ? [value] : [];
  return values
    .flatMap((item) =>
      typeof item === "string" ? (splitTags && scalar ? item.split(/[\s,]+/) : [item]) : []
    )
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function tagsFromCache(cache: CachedMetadata | null): Map<string, string> {
  const tags = new Map<string, string>();
  for (const tag of stringList(cache?.frontmatter?.tags ?? cache?.frontmatter?.tag, true)) {
    tags.set(tag.toLowerCase(), tag);
  }
  for (const item of cache?.tags ?? []) {
    const tag = item.tag.replace(/^#/, "");
    if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  return tags;
}

function stripCode(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

function linkedNoteContext(
  app: App,
  file: TFile,
  existingTagKeys: ReadonlySet<string>
): Pick<TagSuggestionState, "links_out" | "links_in" | "neighbor_tags"> {
  const filesByPath = new Map(app.vault.getMarkdownFiles().map((note) => [note.path, note]));
  const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
  const validPaths = (paths: string[]) =>
    Array.from(new Set(paths))
      .filter((path) => filesByPath.has(path))
      .sort((first, second) => first.localeCompare(second));
  const allLinksOut = validPaths(Object.keys(resolvedLinks[file.path] ?? {}));
  const allLinksIn = validPaths(
    Object.entries(resolvedLinks)
      .filter(([, destinations]) => file.path in destinations)
      .map(([source]) => source)
  );
  const linksOut = allLinksOut.slice(0, MAX_LINKS);
  const linksIn = allLinksIn.slice(0, MAX_LINKS);
  const neighborPaths = new Set([...allLinksOut, ...allLinksIn]);
  const neighborTags = new Map<string, NeighborTag>();
  for (const path of neighborPaths) {
    const note = filesByPath.get(path);
    if (!note) continue;
    for (const [key, tag] of tagsFromCache(app.metadataCache.getFileCache(note))) {
      if (existingTagKeys.has(key)) continue;
      const entry = neighborTags.get(key) ?? { tag, count: 0 };
      entry.count++;
      neighborTags.set(key, entry);
    }
  }
  const result: Pick<TagSuggestionState, "links_out" | "links_in" | "neighbor_tags"> = {};
  if (linksOut.length) result.links_out = linksOut.map((path) => filesByPath.get(path)!.basename);
  if (linksIn.length) result.links_in = linksIn.map((path) => filesByPath.get(path)!.basename);
  const rankedTags = Array.from(neighborTags.values())
    .sort((first, second) => second.count - first.count || first.tag.localeCompare(second.tag))
    .slice(0, MAX_NEIGHBOR_TAGS);
  if (rankedTags.length) result.neighbor_tags = rankedTags;
  return result;
}

export function buildTagSuggestionState(
  app: App,
  file: TFile,
  rawContent: string,
  cache: CachedMetadata | null
): TagSuggestionState {
  const body = stripTagSuggestionFrontmatter(rawContent);
  const existingTags = Array.from(tagsFromCache(cache).values());
  const state: TagSuggestionState = {
    title: file.basename,
    path: file.path,
    folder: file.parent?.path ?? "",
    created: formatLocalDate(file.stat.ctime, true),
    modified: formatLocalDate(file.stat.mtime, true),
    existing_tags: existingTags,
  };
  const aliases = parseFrontMatterAliases(cache?.frontmatter) ?? [];
  if (aliases.length) state.aliases = aliases;
  const properties = frontmatterProperties(cache?.frontmatter);
  if (Object.keys(properties).length) state.properties = properties;
  Object.assign(
    state,
    linkedNoteContext(app, file, new Set(existingTags.map((tag) => tag.toLowerCase())))
  );

  if (body.length <= EXCERPT_CHARS) {
    state.content = body.trim();
    return state;
  }

  const lines = stripCode(body).split(/\r?\n/);
  const headings: string[] = [];
  const sectionLeads: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = /^#{1,6}\s+(.+)$/.exec(lines[index]);
    if (!heading) continue;
    if (headings.length < 40) headings.push(heading[1].trim());
    const lead = lines.slice(index + 1).find((line) => line.trim() && !/^#{1,6}\s/.test(line));
    if (lead && sectionLeads.length < 20) sectionLeads.push(clip(lead.trim(), 160));
    if (headings.length === 40 && sectionLeads.length === 20) break;
  }
  state.headings = headings;
  state.excerpt = clip(body.trim(), EXCERPT_CHARS);
  if (sectionLeads.length) state.section_leads = sectionLeads;
  return state;
}

export function collectTagCandidates(
  app: App,
  activeFile: TFile,
  activeContent: string
): TagCandidate[] {
  const notes: IndexedNote[] = app.vault.getMarkdownFiles().map((file) => ({
    path: file.path,
    folder: file.parent?.path ?? "",
    ctime: file.stat.ctime,
    tags: tagsFromCache(app.metadataCache.getFileCache(file)),
  }));
  const active = notes.find((note) => note.path === activeFile.path);
  const existingKeys = new Set(active?.tags.keys() ?? []);
  const index = new Map<string, { tag: string; notes: IndexedNote[] }>();
  for (const note of notes) {
    for (const [key, tag] of note.tags) {
      const entry = index.get(key) ?? { tag, notes: [] };
      entry.notes.push(note);
      index.set(key, entry);
    }
  }
  const activeFolder = active?.folder ?? activeFile.parent?.path ?? "";
  const activeCreated = active?.ctime ?? activeFile.stat.ctime;
  const text =
    `${activeFile.basename} ${stripTagSuggestionFrontmatter(activeContent)}`.toLowerCase();
  const candidates: TagCandidate[] = [];
  for (const [key, entry] of index) {
    if (existingKeys.has(key) || HEX_COLOUR_TAG.test(key)) continue;
    const users = entry.notes.filter((note) => note.path !== activeFile.path);
    if (!users.length) continue;
    let cooccurrence = 0;
    let sameFolder = 0;
    for (const note of users) {
      if (note.folder === activeFolder) sameFolder++;
      if (Array.from(existingKeys).some((existing) => note.tags.has(existing))) cooccurrence++;
    }
    const lexical = key
      .split(/[/_-]/)
      .some((segment) => segment.length > 2 && text.includes(segment))
      ? 1
      : 0;
    const prior =
      (3 * cooccurrence) / users.length +
      (2 * sameFolder) / users.length +
      2 * lexical +
      Math.log10(1 + users.length);
    candidates.push({
      key,
      tag: entry.tag,
      count: users.length,
      firstUsed: formatLocalDate(Math.min(...users.map((note) => note.ctime))),
      lastUsed: formatLocalDate(Math.max(...users.map((note) => note.ctime))),
      sameFolder,
      sharedTags: cooccurrence,
      examples: [...users]
        .sort(
          (first, second) =>
            Number(second.folder === activeFolder) - Number(first.folder === activeFolder) ||
            Math.abs(first.ctime - activeCreated) - Math.abs(second.ctime - activeCreated) ||
            first.path.localeCompare(second.path)
        )
        .slice(0, EVIDENCE_TITLES)
        .map((note) => ({
          path: clip(note.path, EVIDENCE_PATH_CHARS),
          created: formatLocalDate(note.ctime),
        })),
      prior,
    });
  }
  candidates.sort(
    (first, second) => second.prior - first.prior || first.key.localeCompare(second.key)
  );
  return candidates.slice(0, MAX_CANDIDATES);
}

export function buildEvidenceQuestion(candidate: TagCandidate): NoulQuestion {
  const relationships = [
    candidate.sameFolder
      ? `${candidate.sameFolder} of them ${candidate.sameFolder === 1 ? "is" : "are"} in this note's folder`
      : "",
    candidate.sharedTags
      ? `${candidate.sharedTags} share${candidate.sharedTags === 1 ? "s" : ""} a tag with this note`
      : "",
  ].filter(Boolean);
  const examples = candidate.examples
    .slice(0, EVIDENCE_TITLES)
    .map(({ path, created }) => `${clip(path, EVIDENCE_PATH_CHARS)} (created ${created})`)
    .join("; ");
  const relationshipSentence = relationships.length ? ` ${relationships.join(" and ")}.` : "";
  const exampleSentence = examples ? ` Examples: ${examples}.` : "";
  return {
    type: "noul",
    instructions: `Should this note be tagged "#${candidate.tag}"? In this vault "#${candidate.tag}" is used on ${candidate.count} note${candidate.count === 1 ? "" : "s"}, first on ${candidate.firstUsed} and most recently on ${candidate.lastUsed}.${relationshipSentence}${exampleSentence}`,
  };
}

function estimateTokens(value: string): number {
  const cjk = value.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (value.length - cjk) / 4);
}

function bodySize(
  state: TagSuggestionState,
  questions: Record<string, NoulQuestion>,
  userId: string
): number {
  return new TextEncoder().encode(JSON.stringify({ state, questions, user_id: userId })).byteLength;
}

export function packTagSuggestionRequests(
  state: TagSuggestionState,
  candidates: TagCandidate[],
  userId: string
): PackedTagSuggestionRequest[] {
  const stateTokens = estimateTokens(JSON.stringify(state));
  if (REQUEST_TOKEN_BUDGET - stateTokens < 500) {
    throw new BrevilabsApiError("Tag suggestion state is too large", 413);
  }

  const requests: PackedTagSuggestionRequest[] = [];
  let questions: Record<string, NoulQuestion> = {};
  let requestCandidates: Record<string, TagCandidate> = {};
  let questionTokens = 0;

  const flush = () => {
    if (!Object.keys(questions).length) return;
    requests.push({
      state,
      questions,
      candidates: requestCandidates,
      estimatedTokens: stateTokens + questionTokens,
    });
    questions = {};
    requestCandidates = {};
    questionTokens = 0;
  };

  candidates.forEach((candidate, index) => {
    const id = `t${index}`;
    const question = buildEvidenceQuestion(candidate);
    const cost = Math.ceil((estimateTokens(question.instructions) + 8) * EVIDENCE_TOKEN_MARGIN);
    const nextQuestions = { ...questions, [id]: question };
    if (
      Object.keys(questions).length &&
      (stateTokens + questionTokens + cost > REQUEST_TOKEN_BUDGET ||
        bodySize(state, nextQuestions, userId) > REQUEST_BODY_BYTES)
    ) {
      flush();
    }
    const singleQuestions = { ...questions, [id]: question };
    if (
      stateTokens + questionTokens + cost > REQUEST_TOKEN_BUDGET ||
      bodySize(state, singleQuestions, userId) > REQUEST_BODY_BYTES
    ) {
      throw new BrevilabsApiError("A tag suggestion question is too large", 413);
    }
    questions[id] = question;
    requestCandidates[id] = candidate;
    questionTokens += cost;
  });
  flush();
  return requests;
}

export function rankTagSuggestions(
  requests: PackedTagSuggestionRequest[],
  responses: Array<Record<string, NoulAnswer>>
): RankedTagSuggestion[] {
  const ranked: Array<RankedTagSuggestion & { count: number }> = [];
  responses.forEach((answers, requestIndex) => {
    const request = requests[requestIndex];
    for (const [id, answer] of Object.entries(answers)) {
      const candidate = request?.candidates[id];
      if (candidate && typeof answer.noul === "number") {
        ranked.push({
          tag: candidate.tag,
          score: answer.noul,
          count: candidate.count,
        });
      }
    }
  });
  ranked.sort((first, second) => second.score - first.score || second.count - first.count);
  return ranked.map(({ tag, score }) => ({ tag, score }));
}

export async function addTagToFrontmatter(app: App, file: TFile, tags: string[]): Promise<void> {
  const requested = tags.map((tag) => tag.replace(/^#/, "")).filter(Boolean);
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const key = "tags" in frontmatter ? "tags" : "tag" in frontmatter ? "tag" : "tags";
    const value = frontmatter[key];
    const current = stringList(value, true);
    const seen = new Set(current.map((tag) => tag.toLowerCase()));
    const additions = requested.filter((tag) => {
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    if (additions.length) {
      frontmatter[key] = Array.isArray(value)
        ? [...value, ...additions]
        : typeof value === "string" || value == null
          ? [...current, ...additions]
          : [value, ...additions];
    }
  });
}

export function tagSuggestionErrorNotice(error: unknown): string {
  if (error instanceof BrevilabsApiError) {
    if (error.status === 403) return "A valid Copilot Plus license is required to suggest tags.";
    if (error.status === 413) return "This vault has too much tag data to suggest tags.";
    if (error.status === 429) return "Tag suggestions are rate limited. Try again later.";
    if (error.status === 504) return "Tag suggestions timed out. Try again.";
  }
  return "Couldn’t suggest tags. Check your connection and try again.";
}
