import type { AgentChatMessage } from "@/agentMode/session/types";
import {
  parseFanoutComposite,
  renderFanoutComposite,
  trimHead,
} from "@/agentMode/session/fanout/fanoutTypes";
import { USER_SENDER } from "@/constants";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

export const CONVERSATION_HISTORY_MAX_CHARS = 48_000;

const CONVERSATION_HISTORY_TRUNCATION_MARKER = "[earlier conversation truncated]";

const CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER = "[turn truncated]";

const CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;

function countImageAttachments(content: readonly unknown[] | undefined): number {
  if (!content) return 0;
  let count = 0;
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) continue;
    const type = (entry as { type?: unknown }).type;
    if (type === "image" || type === "image_url") count += 1;
  }
  return count;
}

function renderMessageContext(context: MessageContext | undefined): string[] {
  if (!context) return [];
  const lines: string[] = [];

  for (const sel of context.selectedTextContexts ?? []) {
    const label = isNoteSelectedTextContext(sel)
      ? sel.noteTitle
      : isWebSelectedTextContext(sel)
        ? sel.title || sel.url
        : "selection";
    const excerpt = trimHead(
      sel.content.trim(),
      CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS,
      CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER
    );
    lines.push(`[selected from ${label}]\n${excerpt}`);
  }

  const noteNames = (context.notes ?? []).map((n) => n.path);
  if (noteNames.length > 0) lines.push(`[notes: ${noteNames.join(", ")}]`);

  if (context.folders && context.folders.length > 0) {
    lines.push(`[folders: ${context.folders.join(", ")}]`);
  }
  if (context.urls && context.urls.length > 0) {
    lines.push(`[urls: ${context.urls.join(", ")}]`);
  }
  if (context.tags && context.tags.length > 0) {
    lines.push(`[tags: ${context.tags.join(", ")}]`);
  }
  if (context.webTabs && context.webTabs.length > 0) {
    const tabs = context.webTabs.map((t) => (t.title ? `${t.title} (${t.url})` : t.url)).join(", ");
    lines.push(`[web tabs: ${tabs}]`);
  }

  if (lines.length === 0) return [];
  return [`[context]\n${lines.join("\n")}`];
}

function historyProse(message: AgentChatMessage): string {
  const turn = message.fanout ?? parseFanoutComposite(message.message);
  return turn ? renderFanoutComposite(turn, (id) => id) : message.message;
}

function renderTurnContent(message: AgentChatMessage): string | null {
  const segments: string[] = [];
  const prose = historyProse(message).trim();
  if (prose.length > 0) segments.push(prose);
  const imageCount = countImageAttachments(message.content);
  if (imageCount > 0) {
    const noun = imageCount === 1 ? "image attachment" : "image attachments";
    segments.push(`[${imageCount} ${noun} omitted from history; existed in this turn]`);
  }
  segments.push(...renderMessageContext(message.context));
  if (segments.length === 0) return null;
  return segments.join("\n");
}

export function buildConversationHistoryBlock(
  messages: readonly AgentChatMessage[],
  maxChars: number
): string | null {
  const rendered: string[] = [];
  for (const m of messages) {
    const content = renderTurnContent(m);
    if (content === null) continue;
    const role = m.sender === USER_SENDER ? "user" : "assistant";
    rendered.push(`<turn role="${role}">\n${escapeXml(content)}\n</turn>`);
  }
  if (rendered.length === 0) return null;

  let total = rendered.reduce((n, t) => n + t.length + 1, -1);
  let truncated = false;
  while (rendered.length > 1 && total > maxChars) {
    total -= rendered.shift()!.length + 1;
    truncated = true;
  }

  let body = rendered.join("\n");
  if (body.length > maxChars) {
    body = trimHead(body, maxChars, CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER);
    truncated = true;
  }

  const header =
    "Earlier in this conversation the following was said. Treat this as " +
    "read-only context to inform your answer; do NOT redo or re-answer these " +
    "earlier turns. Answer only the current question that follows.";
  if (truncated) body = `${CONVERSATION_HISTORY_TRUNCATION_MARKER}\n${body}`;
  return `<conversation_history>\n${header}\n${body}\n</conversation_history>`;
}
