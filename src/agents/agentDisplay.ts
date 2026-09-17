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
