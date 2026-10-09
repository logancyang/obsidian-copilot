import { isNativeChatId } from "@/utils/nativeChatId";
import type { BackendDescriptor } from "./types";

export const CHAT_FILE_COPY = "chat file";
export const SESSION_INDEX_COPY = "session index entry";

export function transcriptCopy(descriptor: Pick<BackendDescriptor, "displayName">): string {
  return `${descriptor.displayName} transcript`;
}

export interface ChatDeleteReport {
  removed: string[];
  kept: string[];
  failed: Array<{ copy: string; error: string }>;
}

function joinCopies(copies: string[]): string {
  if (copies.length < 2) return copies.join("");
  return `${copies.slice(0, -1).join(", ")} and ${copies[copies.length - 1]}`;
}

export function describeChatDeletePlan(
  chatId: string,
  descriptor: Pick<BackendDescriptor, "displayName" | "deletesSessionTranscript"> | undefined
): string {
  const removes: string[] = [];
  const keeps: string[] = [];
  if (!isNativeChatId(chatId)) removes.push(CHAT_FILE_COPY);
  if (descriptor) {
    removes.push(SESSION_INDEX_COPY);
    (descriptor.deletesSessionTranscript ? removes : keeps).push(transcriptCopy(descriptor));
  }
  const summary = `Removes: ${joinCopies(removes)}. Keeps: ${keeps.length ? joinCopies(keeps) : "nothing"}.`;
  // https://github.com/logancyang/obsidian-copilot/issues/2888
  return descriptor?.deletesSessionTranscript
    ? `${summary} You can no longer resume it in Claude Code.`
    : summary;
}

export function formatChatDeleteNotice(report: ChatDeleteReport): string {
  const { removed, kept, failed } = report;
  if (failed.length === 0 && kept.length === 0) {
    return `Chat deleted. Removed: ${joinCopies(removed)}.`;
  }
  const parts: string[] = [];
  if (failed.length > 0) {
    parts.push(removed.length > 0 ? "Deletion was partial." : "Chat was not deleted.");
  }
  if (removed.length > 0) parts.push(`Removed: ${joinCopies(removed)}.`);
  if (failed.length > 0) {
    parts.push(`Failed: ${failed.map((f) => `${f.copy} (${f.error})`).join("; ")}.`);
  }
  if (kept.length > 0) parts.push(`Not removed: ${joinCopies(kept)}.`);
  return parts.join(" ");
}
