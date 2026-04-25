/**
 * suggestEditParser - extracts `<suggest_edit>...</suggest_edit>` blocks from
 * the model's reply.
 *
 * Phase C intentionally ships only the full-text parser (operates on the
 * completed reply string). Streaming extraction can be added later as a state
 * machine if users find the raw tag visible during streaming distracting.
 *
 * Rules:
 *   - Ignores tags inside fenced code blocks (``` ... ```).
 *   - Uses the FIRST valid occurrence of the tag pair.
 *   - Strips the entire tag block (open tag, contents, close tag) from the
 *     conversational text and trims surrounding whitespace.
 */

export interface ParsedReply {
  /** The conversational text with the suggest_edit block removed. */
  conversationalText: string;
  /** The proposed replacement text, or undefined if no tag was found. */
  proposedEdit?: string;
}

const OPEN_TAG = "<suggest_edit>";
const CLOSE_TAG = "</suggest_edit>";
const FENCE = "```";

/**
 * Returns the index of the first `<suggest_edit>` tag NOT inside a code fence,
 * or -1 if none found.
 */
function findUnfencedTagIndex(text: string, tag: string, startAt = 0): number {
  let i = startAt;
  let inFence = false;
  while (i < text.length) {
    if (text.startsWith(FENCE, i)) {
      inFence = !inFence;
      i += FENCE.length;
      continue;
    }
    if (!inFence && text.startsWith(tag, i)) {
      return i;
    }
    i++;
  }
  return -1;
}

export function parseSuggestEditReply(text: string): ParsedReply {
  const openIdx = findUnfencedTagIndex(text, OPEN_TAG);
  if (openIdx === -1) {
    return { conversationalText: text.trim() };
  }
  const afterOpen = openIdx + OPEN_TAG.length;
  const closeIdx = findUnfencedTagIndex(text, CLOSE_TAG, afterOpen);
  if (closeIdx === -1) {
    // Malformed — open without close. Leave text alone.
    return { conversationalText: text.trim() };
  }
  const proposedEdit = text.slice(afterOpen, closeIdx).trim();
  const before = text.slice(0, openIdx).trim();
  const after = text.slice(closeIdx + CLOSE_TAG.length).trim();
  const conversationalText = [before, after].filter(Boolean).join("\n\n");
  return { conversationalText, proposedEdit };
}
