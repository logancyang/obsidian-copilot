/**
 * Render a memory file's size for the agent list.
 *
 * The number exists to answer "has this agent learned anything yet", so it is
 * deliberately coarse: bytes below a kilobyte, then one decimal, never more
 * precision than the question deserves.
 *
 * @param bytes - Size of `MEMORY.md` on disk.
 */
export function formatMemorySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Name to show for a chat whose agent no longer exists.
 *
 * A chat persists only its slug, so a deleted agent leaves nothing but the
 * folder name it had. The chat still has to open and still has to say who it
 * was held with, so the slug is turned back into something readable and shown
 * as a plain label while the conversation runs as the default assistant. See
 * `designdocs/CUSTOM_AGENTS.md` §1 and §8.
 *
 * @param slug - Slug persisted on the chat.
 */
export function formatMissingAgentLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
