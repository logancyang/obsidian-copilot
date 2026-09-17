import type { TurnFileChange } from "@/agentMode/session/types";
import { diffLines } from "diff";

/**
 * Describe one file's before/after pair as a reviewable change, or null when
 * the turn left it untouched — an agent that edited a file and then restored
 * it, or wrote back what was already there, has nothing for the user to review.
 *
 * @param path - Vault-relative path of the file.
 * @param before - Content read when the turn first touched the file; null when it did not exist.
 * @param after - Content read when the turn ended; null when the file is gone.
 */
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
