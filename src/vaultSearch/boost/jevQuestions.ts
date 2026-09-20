import type { BoostPoolCandidate } from "@/vaultSearch/boost/boostPool";

/**
 * Demo switch: Miyo passages can be removed from Jev without changing pool construction.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/516
 */
export const SEND_MIYO_CONTENT_TO_JEV = true;
export const MAX_MIYO_CONTENT_CHARS = 600;

interface JevFileQuestion {
  name: string;
  folder: string;
  type: string;
  created: string;
  modified: string;
  size: string;
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

function localDate(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} (${relativeDay(timestamp, now)})`;
}

function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Build one Jev noul question per candidate, with bounded Miyo content when available. */
export function buildJevRequest(
  query: string,
  vault: string,
  pool: BoostPoolCandidate[],
  now: Date
) {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const state = {
    query,
    now: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${weekday} ${pad(now.getHours())}:${pad(now.getMinutes())}, local time`,
    vault,
  };
  const questions: Record<string, JevSearchQuestion> = {};
  pool.forEach(({ candidate, file, sources, searchScore, searchRank }, index) => {
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
          tags: file.tags,
          search_score: searchScore,
          search_rank: searchRank,
          ...(SEND_MIYO_CONTENT_TO_JEV && sources.includes("miyo") && candidate.content
            ? { content: candidate.content.slice(0, MAX_MIYO_CONTENT_CHARS) }
            : {}),
        },
      },
      criteria: {
        true: "The file matches what the query describes, including the requested decision and whether it is current",
        false:
          "The file does not match one or more things the query asks for, is only topically related, or records a superseded decision",
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
