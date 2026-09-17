import type { AgentFileManager } from "@/agents/AgentFileManager";
import {
  buildAgentMemoryFlushPrompt,
  formatMemoryEntryDate,
  parseMemoryFlushBullets,
} from "@/agents/agentMemory";
import { buildDailyNoteSection } from "@/agents/agentMemoryFile";
import {
  buildConversationHistoryBlock,
  FANOUT_HISTORY_MAX_CHARS,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";
import type { AgentChatMessage, BackendId } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { err2String, formatDateTime } from "@/utils";
import { v4 as uuidv4 } from "uuid";

/**
 * Framing the agent reads the conversation under. The fan-out default tells the
 * reader to answer the question that follows; there is no question here, only
 * notes to take.
 */
const MEMORY_TRANSCRIPT_HEADER =
  "This is the conversation you have been having with the user, in order. " +
  "Read it for what is worth remembering; do not reply to it.";

/** One stretch of conversation to fold into one agent's daily note. */
export interface AgentMemoryFlushRequest {
  /** Agent whose daily note is being appended to. */
  agentSlug: string;
  /** Backend the conversation ran on, used when the agent pins none of its own. */
  sessionBackendId: BackendId;
  /** The turns since the agent last flushed, in transcript order. */
  messages: readonly AgentChatMessage[];
  /** Chat title, which names the heading the bullets land under. */
  chatTitle: string;
  /** Aborts the sub-session; the pass then reports `failed`. */
  signal: AbortSignal;
  /** Clock, passed in so the note and heading a flush writes are testable. */
  now?: Date;
}

/** What a finished flush did, so the caller can decide what to persist and show. */
export type AgentMemoryFlushOutcome =
  | { status: "written"; agentName: string; notePath: string; date: string }
  /** Nothing to do: not an agent with memory, nothing new, or nothing worth keeping. */
  | { status: "skipped"; reason: "no-agent" | "memory-off" | "no-turns" | "nothing-to-keep" }
  | { status: "failed"; error: string };

/** Collaborators the pass drives; injected so it is testable without a backend. */
export interface AgentMemoryPassDeps {
  files: AgentFileManager;
  subSessions: ReadOnlySubSessionRunner;
}

/**
 * Fold one stretch of conversation into its agent's daily note.
 *
 * The agent decides what is worth keeping, but never holds the pen: the pass
 * runs in a fresh read-only sub-session with no write tool, and the plugin
 * appends what comes back. It returns bullets rather than a file because the
 * note it lands in is shared with the agent's own in-turn writes and with
 * every other conversation of that day — only consolidation rewrites anything
 * whole. See `designdocs/CUSTOM_AGENTS.md` §5 ("Daily notes").
 *
 * Never throws: a backend failure is an outcome, because the caller is a
 * conversation boundary or an idle timer that must go on regardless.
 *
 * @param deps - The agent folder reader and the sub-session runner.
 * @param request - Which agent, on which backend, over which turns.
 */
export async function runAgentMemoryFlush(
  deps: AgentMemoryPassDeps,
  request: AgentMemoryFlushRequest
): Promise<AgentMemoryFlushOutcome> {
  try {
    const record = await deps.files.readAgent(request.agentSlug);
    // A chat outlives the agent it was held with, so a deleted agent is a
    // no-op rather than an error (`designdocs/CUSTOM_AGENTS.md` §1).
    if (!record) return { status: "skipped", reason: "no-agent" };
    const { agent } = record;
    if (!agent.memoryEnabled) return { status: "skipped", reason: "memory-off" };

    const transcript = buildConversationHistoryBlock(
      request.messages,
      FANOUT_HISTORY_MAX_CHARS,
      MEMORY_TRANSCRIPT_HEADER
    );
    if (!transcript) return { status: "skipped", reason: "no-turns" };

    const prompt = buildAgentMemoryFlushPrompt({ agentName: agent.name, transcript });

    let returned = "";
    const outcome = await deps.subSessions.run({
      backendId: agent.backendId || request.sessionBackendId,
      prompt: [{ type: "text", text: prompt }],
      signal: request.signal,
      onText: (text) => {
        returned += text;
      },
    });
    if (outcome === "aborted") return { status: "failed", error: "Memory flush was cancelled." };
    // A reply with no text at all is the backend failing quietly, not the agent
    // deciding there was nothing to keep, so the marker must not advance past
    // turns that were never read (`designdocs/CUSTOM_AGENTS.md` §5).
    if (returned.trim().length === 0) {
      logWarn(`[Agents] Memory flush for "${request.agentSlug}" returned no text`);
      return { status: "failed", error: "Memory flush returned no text." };
    }

    const bullets = parseMemoryFlushBullets(returned);
    // A conversation that taught the agent nothing leaves no heading behind, so
    // a day of notes reads as the days that mattered.
    if (bullets.length === 0) {
      logInfo(
        `[Agents] Memory flush for "${request.agentSlug}" kept nothing: ${returned.trim().slice(0, 120)}`
      );
      return { status: "skipped", reason: "nothing-to-keep" };
    }

    const at = request.now ?? new Date();
    const date = formatMemoryEntryDate(at);
    const notePath = await deps.files.appendDailyNote(
      agent.slug,
      date,
      buildDailyNoteSection({ at, chatTitle: request.chatTitle, bullets })
    );
    logInfo(`[Agents] Appended ${bullets.length} note(s) to ${notePath}`);
    return { status: "written", agentName: agent.name, notePath, date };
  } catch (error) {
    logWarn(`[Agents] Memory flush failed for "${request.agentSlug}"`, error);
    return { status: "failed", error: err2String(error) };
  }
}

/**
 * The two-message transcript one agent's fan-out answer is memorized from: the
 * user's question and that agent's own answer, and nothing else.
 *
 * An agent consulted in a fan-out turn read only those two things — not the
 * other agents' answers and not the summary — so feeding it any more would have
 * it remember words it never saw (`designdocs/CUSTOM_AGENTS.md` §6).
 *
 * @param question - The user's prompt, as the turn sent it.
 * @param answer - What this agent replied.
 */
export function buildFanoutMemoryTranscript(question: string, answer: string): AgentChatMessage[] {
  const timestamp = formatDateTime(new Date());
  return [
    {
      id: uuidv4(),
      sender: USER_SENDER,
      timestamp,
      isVisible: true,
      message: question,
    },
    {
      id: uuidv4(),
      sender: AI_SENDER,
      timestamp,
      isVisible: true,
      message: answer,
    },
  ];
}
