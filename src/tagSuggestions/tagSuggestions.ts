import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import { stripFrontmatter } from "@/utils";
import { App, CachedMetadata, TFile } from "obsidian";

const EXCERPT_CHARS = 1500;
const EVIDENCE_TITLES = 4;
const TITLE_CHARS = 60;
const REQUEST_TOKEN_BUDGET = 28_000;
const REQUEST_BODY_BYTES = 256 * 1024;
const MAX_CANDIDATES = 600;
const EVIDENCE_TOKEN_MARGIN = 1.3;
const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
const HEX_COLOUR_TAG = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface TagSuggestionState {
  title: string;
  folder: string;
  existing_tags: string[];
  aliases?: string[];
  content?: string;
  headings?: string[];
  excerpt?: string;
  section_leads?: string[];
}

export interface TagCandidate {
  key: string;
  tag: string;
  count: number;
  titles: string[];
  prior: number;
}

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
  title: string;
  folder: string;
  mtime: number;
  tags: Map<string, string>;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
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

export function buildTagSuggestionState(
  file: TFile,
  rawContent: string,
  cache: CachedMetadata | null
): TagSuggestionState {
  const body = stripFrontmatter(rawContent);
  const existingTags = Array.from(tagsFromCache(cache).values());
  const state: TagSuggestionState = {
    title: file.basename,
    folder: file.parent?.path ?? "",
    existing_tags: existingTags,
  };
  const aliases = stringList(cache?.frontmatter?.aliases ?? cache?.frontmatter?.alias, true);
  if (aliases.length) state.aliases = aliases;

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
    title: file.basename,
    folder: file.parent?.path ?? "",
    mtime: file.stat.mtime,
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
  for (const entry of index.values()) {
    entry.notes.sort((first, second) => second.mtime - first.mtime);
  }

  const activeFolder = active?.folder ?? activeFile.parent?.path ?? "";
  const text = `${activeFile.basename} ${stripFrontmatter(activeContent)}`.toLowerCase();
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
      titles: users.map((note) => note.title),
      prior,
    });
  }
  candidates.sort(
    (first, second) => second.prior - first.prior || first.key.localeCompare(second.key)
  );
  return candidates.slice(0, MAX_CANDIDATES);
}

export function buildEvidenceQuestion(candidate: TagCandidate): NoulQuestion {
  const titles = candidate.titles
    .slice(0, EVIDENCE_TITLES)
    .map((title) => clip(title, TITLE_CHARS))
    .join("; ");
  return {
    type: "noul",
    instructions: `Should this note be tagged "#${candidate.tag}"? In this vault "#${candidate.tag}" is used on ${candidate.count} note${candidate.count === 1 ? "" : "s"}, such as: ${titles}.`,
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

export async function addTagToFrontmatter(app: App, file: TFile, tag: string): Promise<void> {
  const normalized = tag.replace(/^#/, "");
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const current = stringList(frontmatter.tags, true);
    if (!current.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      frontmatter.tags = [...current, normalized];
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
