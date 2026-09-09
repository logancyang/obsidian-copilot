import type { ProgressEvent } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { formatBytes } from "@/utils/formatBytes";

/**
 * Describes managed opencode install progress in the settings header.
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
        // A server can send more bytes than its Content-Length promised.
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
