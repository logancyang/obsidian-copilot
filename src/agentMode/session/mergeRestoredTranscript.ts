import type { AgentChatMessage } from "@/agentMode/session/types";

/**
 * Anchor restored turns by user text, preserving saved images and note-only turns.
 * Returning the note unchanged with a nonempty backend signals an unmatched final turn.
 * https://github.com/logancyang/obsidian-copilot/issues/3225
 * @param note Messages preserved in the saved Markdown note.
 * @param backend Messages restored by the backend.
 */
export function mergeRestoredTranscript(
  note: AgentChatMessage[],
  backend: AgentChatMessage[]
): AgentChatMessage[] {
  if (backend.length === 0) return note;
  const norm = (text: string) =>
    text
      .replace(/^\s*!\[\[.*\]\]\s*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  let u = note.length - 1;
  while (u >= 0 && note[u].sender !== "user") u--;
  let k = backend.length - 1;
  while (
    k >= 0 &&
    (u < 0 || backend[k].sender !== "user" || norm(backend[k].message) !== norm(note[u].message))
  )
    k--;
  if (k < 0) {
    const backendUsers = new Set(
      backend.filter((m) => m.sender === "user").map((m) => norm(m.message))
    );
    return note.some((m) => m.sender === "user" && backendUsers.has(norm(m.message)))
      ? note
      : [...note, ...backend];
  }
  const result = [...note];
  const savedAnswer = note[u + 1];
  const restoredAnswer = backend[k + 1];
  if (
    savedAnswer?.sender === "ai" &&
    restoredAnswer?.sender === "ai" &&
    restoredAnswer.message.length > savedAnswer.message.length
  ) {
    result[u + 1] = { ...savedAnswer, message: restoredAnswer.message };
  }
  return [...result, ...backend.slice(k + (note.length - u))];
}
