import type { AgentFileManager } from "@/agents/AgentFileManager";
import { buildAgentMemorySkeleton } from "@/agents/agentFile";
import {
  buildAgentMemoryPrompt,
  reviewMemoryUpdate,
  type MemoryUpdateRejection,
} from "@/agents/agentMemory";
import {
  buildConversationHistoryBlock,
  FANOUT_HISTORY_MAX_CHARS,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";
import type { AgentChatMessage, BackendId } from "@/agentMode/session/types";
import { logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";

/**
 * Framing the agent reads the ended conversation under. The fan-out default
 * tells the reader to answer the question that follows; there is no question
 * here, only a file to rewrite.
 */
const MEMORY_TRANSCRIPT_HEADER =
  "This is the conversation you have just finished with the user, in order. " +
  "Read it for what is worth remembering; do not reply to it.";

/** One conversation's worth of work for one agent's memory file. */
export interface AgentMemoryPassRequest {
  /** Agent whose `MEMORY.md` is being updated. */
  agentSlug: string;
  /** Backend the conversation ran on, used when the agent pins none of its own. */
  sessionBackendId: BackendId;
  /** The turns since the agent last memorized, in transcript order. */
  messages: readonly AgentChatMessage[];
  /** Aborts the sub-session; the pass then reports `failed`. */
  signal: AbortSignal;
}

/** What a finished pass did, so the caller can decide what to persist and show. */
export type AgentMemoryPassOutcome =
  | { status: "written"; agentName: string; memoryPath: string }
  /** Nothing to do: not an agent with memory, or nothing new to memorize. */
  | { status: "skipped"; reason: "no-agent" | "memory-off" | "no-turns" }
  /** The safety rails refused what came back; the old file stands. */
  | { status: "rejected"; reason: MemoryUpdateRejection }
  | { status: "failed"; error: string };

/** Collaborators the pass drives; injected so it is testable without a backend. */
export interface AgentMemoryPassDeps {
  files: AgentFileManager;
  subSessions: ReadOnlySubSessionRunner;
}

/**
 * Run one agent's memory update after a conversation with it has ended.
 *
 * The agent rewrites its own file, but never holds the pen: the pass runs in a
 * fresh read-only sub-session with no write tool, and the plugin writes what
 * comes back only once the safety rails accept it. `MEMORY.md` is re-read from
 * disk here rather than reused from the session, so a user's own edit is the
 * baseline the agent revises. See `designdocs/CUSTOM_AGENTS.md` §5 ("Memory").
 *
 * Never throws: a backend failure is an outcome, because the caller is a
 * conversation boundary that must go on regardless.
 *
 * @param deps - The agent folder reader and the sub-session runner.
 * @param request - Which agent, on which backend, over which turns.
 */
export async function runAgentMemoryPass(
  deps: AgentMemoryPassDeps,
  request: AgentMemoryPassRequest
): Promise<AgentMemoryPassOutcome> {
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

    const stored = await deps.files.readMemoryDocument(agent.slug);
    // A hand-deleted memory file leaves the agent with the skeleton it started
    // life with, so the pass always has the fixed headings to revise.
    const currentMemory = stored?.text.trim() || buildAgentMemorySkeleton(agent.name);

    const prompt = buildAgentMemoryPrompt({
      agentName: agent.name,
      currentMemory,
      transcript,
      today: new Date(),
    });

    let returned = "";
    const outcome = await deps.subSessions.run({
      backendId: agent.backendId || request.sessionBackendId,
      prompt: [{ type: "text", text: prompt }],
      signal: request.signal,
      onText: (text) => {
        returned += text;
      },
    });
    if (outcome === "aborted") return { status: "failed", error: "Memory update was cancelled." };

    const review = reviewMemoryUpdate(currentMemory, returned);
    if (!review.accepted) {
      // Logged, never shown: the file is unchanged, so there is nothing the
      // user could act on (`designdocs/CUSTOM_AGENTS.md` §5, "Safety rails").
      logWarn(
        `[Agents] Rejected a memory update for "${agent.slug}" (${review.reason}); keeping the existing file`
      );
      return { status: "rejected", reason: review.reason };
    }

    const memoryPath = await deps.files.writeMemory(agent.slug, review.text);
    logInfo(`[Agents] Updated memory at ${memoryPath}`);
    return { status: "written", agentName: agent.name, memoryPath };
  } catch (error) {
    logWarn(`[Agents] Memory update failed for "${request.agentSlug}"`, error);
    return { status: "failed", error: err2String(error) };
  }
}
