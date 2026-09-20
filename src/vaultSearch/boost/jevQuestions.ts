import type { BoostPoolCandidate } from "@/vaultSearch/boost/boostPool";
import type { SearchFile } from "@/vaultSearch/types";

/**
 * Demo switch: Miyo passages can be removed from Jev without changing pool construction.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/516
 */
export const SEND_MIYO_CONTENT_TO_JEV = true;
export const MAX_MIYO_CONTENT_CHARS = 600;
/** Demo switch: disclose the checked-type vault inventory so Jev can answer comparisons. */
export const SEND_VAULT_FILE_LIST_TO_JEV = true;
export const MAX_JEV_FILE_LIST_FILES = 2_000;

interface JevFileQuestion {
  name: string;
  folder: string;
  type: string;
  created: string;
  modified: string;
  size: string;
  size_rank: string;
  created_rank: string;
  modified_rank: string;
  tags: string[];
  search_score: number | null;
  search_rank: number | null;
  content?: string;
}

export interface JevSearchQuestion {
  type: "noul";
  instructions: { ask: string; file: JevFileQuestion };
  criteria: { true: string; false: string };
}

export interface JevNoulAnswer {
  noul?: number;
}

interface JevSearchState {
  query: string;
  now: string;
  vault: string;
  file_type_counts: Record<string, number>;
  file_inventory?: string;
  file_inventory_omitted?: true;
}

interface FileRanks {
  type: string;
  total: number;
  size: number;
  created: number;
  modified: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function relativeDay(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const difference = Math.round((day - today) / 86_400_000);
  if (difference === 0) return "today";
  if (difference === -1) return "yesterday";
  if (difference === 1) return "tomorrow";
  return difference < 0 ? `${-difference} days ago` : `in ${difference} days`;
}

function absoluteLocalDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDate(timestamp: number, now: Date): string {
  return `${absoluteLocalDate(timestamp)} (${relativeDay(timestamp, now)})`;
}

function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function fileType(file: SearchFile): string {
  return file.extension || "no-extension";
}

function rankLabel(rank: number, total: number, type: string, order: string): string {
  return `${rank} of ${total} ${type} files (${order} first)`;
}

function rankBy(files: SearchFile[], field: "size" | "ctime" | "mtime"): Map<string, number> {
  const sorted = [...files].sort(
    (left, right) => right[field] - left[field] || left.path.localeCompare(right.path)
  );
  const ranks = new Map<string, number>();
  let rank = 1;
  sorted.forEach((file, index) => {
    if (index > 0 && file[field] !== sorted[index - 1][field]) rank = index + 1;
    ranks.set(file.path, rank);
  });
  return ranks;
}

function fileRanks(files: SearchFile[]): Map<string, FileRanks> {
  const byType = new Map<string, SearchFile[]>();
  for (const file of files) {
    const type = fileType(file);
    const group = byType.get(type) ?? [];
    group.push(file);
    byType.set(type, group);
  }
  const result = new Map<string, FileRanks>();
  for (const [type, group] of byType) {
    const size = rankBy(group, "size");
    const created = rankBy(group, "ctime");
    const modified = rankBy(group, "mtime");
    for (const file of group) {
      result.set(file.path, {
        type,
        total: group.length,
        size: size.get(file.path)!,
        created: created.get(file.path)!,
        modified: modified.get(file.path)!,
      });
    }
  }
  return result;
}

function inventoryCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}

function buildState(query: string, vault: string, files: SearchFile[], now: Date): JevSearchState {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const fileTypeCounts: Record<string, number> = {};
  for (const file of files) {
    const type = fileType(file);
    fileTypeCounts[type] = (fileTypeCounts[type] ?? 0) + 1;
  }
  const state: JevSearchState = {
    query,
    now: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${weekday} ${pad(now.getHours())}:${pad(now.getMinutes())}, local time`,
    vault,
    file_type_counts: fileTypeCounts,
  };
  if (!SEND_VAULT_FILE_LIST_TO_JEV) return state;
  if (files.length > MAX_JEV_FILE_LIST_FILES) {
    state.file_inventory_omitted = true;
    return state;
  }
  const rows = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(
      (file) =>
        `${inventoryCell(file.path)}\t${fileType(file)}\t${file.size}\t${absoluteLocalDate(file.ctime)}\t${absoluteLocalDate(file.mtime)}`
    );
  state.file_inventory = ["path\ttype\tsize_bytes\tcreated\tmodified", ...rows].join("\n");
  return state;
}

/** Build one Jev noul question per candidate, with bounded Miyo content when available. */
export function buildJevRequest(
  query: string,
  vault: string,
  pool: BoostPoolCandidate[],
  files: SearchFile[],
  now: Date
) {
  const state = buildState(query, vault, files, now);
  const ranks = fileRanks(files);
  const questions: Record<string, JevSearchQuestion> = {};
  pool.forEach(({ candidate, file, sources, searchScore, searchRank }, index) => {
    const rank = ranks.get(file.path) ?? {
      type: fileType(file),
      total: 1,
      size: 1,
      created: 1,
      modified: 1,
    };
    questions[`c${index}`] = {
      type: "noul",
      instructions: {
        ask: "Is this file what the user is searching for?",
        file: {
          name: file.name,
          folder: candidate.folder,
          type: file.extension || "file",
          created: localDate(file.ctime, now),
          modified: localDate(file.mtime, now),
          size: fileSize(file.size),
          size_rank: rankLabel(rank.size, rank.total, rank.type, "largest"),
          created_rank: rankLabel(rank.created, rank.total, rank.type, "newest"),
          modified_rank: rankLabel(rank.modified, rank.total, rank.type, "newest"),
          tags: file.tags,
          search_score: searchScore,
          search_rank: searchRank,
          ...(SEND_MIYO_CONTENT_TO_JEV && sources.includes("miyo") && candidate.content
            ? { content: candidate.content.slice(0, MAX_MIYO_CONTENT_CHARS) }
            : {}),
        },
      },
      criteria: {
        true: "The file satisfies what the query asks for. Use the vault inventory and peer ranks for comparative or metadata requests. Only when the query asks about a decision, require the requested decision and whether it is current or supersedes another decision",
        false:
          "The file does not satisfy one or more things the query asks for, or is only topically related. When the query asks about a decision, a different or superseded decision is false",
      },
    };
  });
  return { state, questions };
}

export function parseJevProbabilities(
  pool: BoostPoolCandidate[],
  answers: Record<string, JevNoulAnswer>
): Map<string, number> {
  const probabilities = new Map<string, number>();
  Object.entries(answers).forEach(([id, answer]) => {
    const candidate = pool[Number(id.slice(1))];
    if (candidate && typeof answer.noul === "number" && Number.isFinite(answer.noul)) {
      probabilities.set(candidate.candidate.path, answer.noul);
    }
  });
  return probabilities;
}
