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

const MEMORY_TRANSCRIPT_HEADER =
  "This is the conversation you have been having with the user, in order. " +
  "Read it for what is worth remembering; do not reply to it.";

export interface AgentMemoryFlushRequest {
  agentSlug: string;
  sessionBackendId: BackendId;
  messages: readonly AgentChatMessage[];
  chatTitle: string;
  signal: AbortSignal;
  now?: Date;
}

export type AgentMemoryFlushOutcome =
  | { status: "written"; agentName: string; notePath: string; date: string }
  | { status: "skipped"; reason: "no-agent" | "memory-off" | "no-turns" | "nothing-to-keep" }
  | { status: "failed"; error: string };

export interface AgentMemoryPassDeps {
  files: AgentFileManager;
  subSessions: ReadOnlySubSessionRunner;
}

export async function runAgentMemoryFlush(
  deps: AgentMemoryPassDeps,
  request: AgentMemoryFlushRequest
): Promise<AgentMemoryFlushOutcome> {
  try {
    const record = await deps.files.readAgent(request.agentSlug);
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
    if (returned.trim().length === 0) {
      logWarn(`[Agents] Memory flush for "${request.agentSlug}" returned no text`);
      return { status: "failed", error: "Memory flush returned no text." };
    }

    const bullets = parseMemoryFlushBullets(returned);
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
