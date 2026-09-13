import type { AgentChatMessage } from "@/agentMode/session/types";

/**
 * Keep saved images and timestamps that text-only backend replay cannot restore.
 * A mismatched sender prefix cannot safely be combined with the saved note.
 * https://github.com/logancyang/obsidian-copilot/issues/3225
 * @param note Messages preserved in the saved Markdown note.
 * @param backend Messages restored by the backend.
 */
export function mergeRestoredTranscript(
  note: AgentChatMessage[],
  backend: AgentChatMessage[]
): AgentChatMessage[] {
  if (backend.length <= note.length) return note;
  if (note.some((message, index) => message.sender !== backend[index].sender)) return backend;
  return [...note, ...backend.slice(note.length)];
}
