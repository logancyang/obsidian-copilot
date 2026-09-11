import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentTaskRecord } from "@/agentMode/session/voiceTypes";
import {
  MAX_STARTUP_CONTEXT_CHARS,
  MAX_STARTUP_CONTEXT_MESSAGES,
  type StartupContextMessage,
} from "@/agentMode/voice/voiceProtocol";
import { USER_SENDER } from "@/constants";

/**
 * Headroom kept under the protocol's bounds for the developer note and for
 * formatting. Seeding is a courtesy to the spoken conversation, not the
 * authoritative history — that stays in Copilot.
 */
const STARTUP_MESSAGE_BUDGET = MAX_STARTUP_CONTEXT_MESSAGES - 4;
const STARTUP_CHAR_BUDGET = MAX_STARTUP_CONTEXT_CHARS - 2_000;

/** Longest single seeded entry; a long answer is summarized by its opening. */
const MAX_SEEDED_ENTRY_CHARS = 1_200;

/** Marker that says plainly that older conversation was left out. */
const OMISSION_NOTE =
  "Earlier parts of this conversation are not included here. Copilot has the full history on screen.";

/** What a call needs to know about the conversation it is joining. */
export interface VoiceStartupContextInput {
  /** The public transcript, oldest first. */
  messages: readonly AgentChatMessage[];
  /** Task records for the same conversation. */
  tasks: readonly AgentTaskRecord[];
  /** Name of the single selected local agent. */
  backendDisplayName: string;
  /** Short factual lines about what the user is looking at right now. */
  uiContext?: readonly string[];
}

/**
 * Serialize bounded recent conversation, current task facts, and the visible
 * UI context for a new live session.
 *
 * A fresh call knows nothing: it has never seen the typed exchanges above it,
 * and it must not invent them. Recent verbatim exchanges plus explicit task
 * facts are preferred over any summarization step, and anything dropped is
 * declared rather than silently missing.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Text and voice context continuity".
 *
 * @param input - Transcript, tasks, agent name, and current UI facts.
 */
export function buildVoiceStartupContext(
  input: VoiceStartupContextInput
): readonly StartupContextMessage[] {
  const exchanges: StartupContextMessage[] = [];
  let chars = 0;
  let omitted = 0;
  // Newest first while filling: the exchange the user is about to refer to
  // matters more than the one that opened the chat.
  for (let i = input.messages.length - 1; i >= 0; i -= 1) {
    const message = input.messages[i];
    const content = boundEntry(message.message);
    if (content.length === 0) continue;
    const entry: StartupContextMessage = {
      role: message.sender === USER_SENDER ? "user" : "assistant",
      content,
    };
    if (
      exchanges.length >= STARTUP_MESSAGE_BUDGET ||
      chars + content.length > STARTUP_CHAR_BUDGET
    ) {
      omitted += 1;
      continue;
    }
    chars += content.length;
    exchanges.unshift(entry);
  }

  const facts = describeTaskFacts(input.tasks, input.backendDisplayName);
  const developerLines = [
    `The user is continuing an existing Copilot conversation. ${input.backendDisplayName} is the local agent doing the work.`,
    ...(omitted > 0 ? [OMISSION_NOTE] : []),
    ...(facts.length > 0 ? ["Current local task status:", ...facts] : []),
    ...(input.uiContext && input.uiContext.length > 0
      ? ["What the user has open in Copilot:", ...input.uiContext]
      : []),
  ];
  return Object.freeze([
    { role: "developer" as const, content: developerLines.join("\n") },
    ...exchanges,
  ]);
}

/**
 * State every task in one line each. Only accepted work is described: a call
 * that starts mid-task must learn the task is already running so it never
 * submits it a second time.
 *
 * @param tasks - Task records for the conversation.
 * @param backendDisplayName - Agent name, so speech can refer to it.
 */
function describeTaskFacts(
  tasks: readonly AgentTaskRecord[],
  backendDisplayName: string
): readonly string[] {
  const lines: string[] = [];
  for (const task of tasks) {
    switch (task.state) {
      case "queued":
        lines.push(`- Task ${task.taskId} is queued for ${backendDisplayName}.`);
        break;
      case "running":
        lines.push(
          `- Task ${task.taskId} is already running on ${backendDisplayName}. Do not ask for it again.`
        );
        break;
      case "awaiting-user":
        lines.push(`- Task ${task.taskId} is waiting for the user to answer a request in Copilot.`);
        break;
      case "completed":
        lines.push(`- Task ${task.taskId} finished; its answer is on screen in Copilot.`);
        break;
      case "interrupted":
        lines.push(`- Task ${task.taskId} was interrupted, so its outcome is unconfirmed.`);
        break;
      default:
        // A cancelled or failed task produced nothing worth carrying into a
        // new call; its row on screen already says what happened.
        break;
    }
  }
  return lines;
}

/** Trim one entry to the seeding bound, saying so when it was cut. */
function boundEntry(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SEEDED_ENTRY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_SEEDED_ENTRY_CHARS).trimEnd()}… (shortened; the full text is in Copilot)`;
}
