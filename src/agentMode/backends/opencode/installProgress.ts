import type { ProgressEvent } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { formatBytes } from "@/utils/formatBytes";

/**
 * Narrates where a managed opencode install currently is. Shared by the
 * Configure dialog and the inline install row so both surfaces describe the
 * same pipeline with the same words.
 *
 * @param e - Latest progress event, or `null` before the first one arrives.
 */
export function phaseLabel(e: ProgressEvent | null): string {
  if (!e) return "Starting…";
  switch (e.phase) {
    case "resolve":
      return e.message;
    case "download":
      if (e.total) {
        // Capped like the bar's own value: a server that under-reports its
        // `Content-Length` sends more bytes than it promised, and the two
        // surfaces would then disagree — a full bar beside "300%".
        //
        // DESIGN NOTE: this repeats one line of `phaseProgress` on purpose.
        // Delegating to it instead reads `phaseProgress(e) ?? 0`, and that
        // fallback is unreachable — the `if (e.total)` above is exactly the
        // condition under which `phaseProgress` returns a number — so it is a
        // defensive branch for an impossible state. Extracting a shared helper
        // was considered and rejected: two adjacent call sites of one clamp do
        // not add up to a domain concept worth a name and a jump.
        // If a future review flags this again, point them at this note.
        const pct = Math.min(100, Math.floor((e.received / e.total) * 100));
        return `Downloading ${e.assetName} — ${formatBytes(e.received)} / ${formatBytes(e.total)} (${pct}%)`;
      }
      return `Downloading ${e.assetName} — ${formatBytes(e.received)}`;
    case "extract":
      return e.message;
    case "done":
      return "Done";
  }
}

/**
 * Completion percentage for the progress bar. Returns `undefined` for phases
 * that carry no measurable fraction (resolving, or a download the server sent
 * no content-length for) so the bar shows its zero state instead of inventing
 * progress.
 *
 * @param e - Latest progress event, or `null` before the first one arrives.
 */
export function phaseProgress(e: ProgressEvent | null): number | undefined {
  if (!e) return undefined;
  if (e.phase === "download" && e.total) {
    return Math.min(100, Math.floor((e.received / e.total) * 100));
  }
  if (e.phase === "extract") return 98;
  if (e.phase === "done") return 100;
  return undefined;
}
