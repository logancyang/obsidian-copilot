import type { TurnFileChange } from "@/agentMode/session/types";
import { diffLines } from "diff";

export function buildTurnFileChange(
  path: string,
  before: string | null,
  after: string | null
): TurnFileChange | null {
  if (before === after) return null;
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before ?? "", after ?? "")) {
    if (part.added) additions += part.count ?? 0;
    else if (part.removed) deletions += part.count ?? 0;
  }
  const status = before === null ? "created" : after === null ? "deleted" : "modified";
  return { path, status, before, after, additions, deletions };
}
