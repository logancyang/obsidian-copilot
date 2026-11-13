import type { AgentChatMessage } from "@/agentMode/session/types";
import { diffTargetPaths, editTargetPaths } from "@/agentMode/session/editTargets";
import {
  parseFanoutComposite,
  renderFanoutComposite,
  trimHead,
} from "@/agentMode/session/fanout/fanoutTypes";
import { USER_SENDER } from "@/constants";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { CHAT_IMAGE_EMBED } from "@/utils/chatImagePersistence";
import { isAbsolutePath } from "@/utils/vaultPath";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

export const MENTION_HISTORY_MAX_CHARS = 48_000;

export const SAVED_HISTORY_MAX_CHARS = 200_000;

export interface ConversationHistoryBlock {
  text: string;
  truncated: boolean;
}

const CONVERSATION_HISTORY_TRUNCATION_MARKER = "[earlier conversation truncated]";

const CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER = "[turn truncated]";

const CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;

function attachedImages(content: readonly unknown[] | undefined): (string | null)[] {
  const images: (string | null)[] = [];
  for (const entry of content ?? []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, image_url } = entry as { type?: unknown; image_url?: { url?: unknown } };
    if (type === "image_url" && typeof image_url?.url === "string") images.push(image_url.url);
    else if (type === "image" || type === "image_url") images.push(null);
  }
  return images;
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

function renderTurnContent(
  message: AgentChatMessage,
  vaultBase: string | null,
  savedImagePath: (image: string) => string | null
): string | null {
  const segments: string[] = [];
  // The agent gets the saved file of each earlier image so it can open it, never the image data; a reopened chat holds its images as note embeds.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/907
  const images = attachedImages(message.content);
  const prose = historyProse(message)
    .replace(CHAT_IMAGE_EMBED, (embed) => {
      images.push(embed);
      return "";
    })
    .trim();
  if (prose.length > 0) segments.push(prose);
  const tools = toolsUsedLines(message, vaultBase);
  if (tools.length > 0) segments.push(`[tools used]\n${tools.join("\n")}`);
  let omitted = 0;
  for (const image of images) {
    const path = image === null ? null : savedImagePath(image);
    if (path === null) omitted += 1;
    else segments.push(`[image attachment saved at ${path}]`);
  }
  if (omitted > 0) {
    const noun = omitted === 1 ? "image attachment" : "image attachments";
    segments.push(`[${omitted} ${noun} omitted from history; existed in this turn]`);
  }
  segments.push(...renderMessageContext(message.context));
  if (segments.length === 0) return null;
  return segments.join("\n");
}

const TOOLS_USED_MAX_LINES = 20;

const EMPTY_TOOLS_USED: readonly string[] = Object.freeze([]);

// The history block lists one call per line, so each line stays single-line; repeats merge and a reply keeps at most 20 lines.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/906
function toolsUsedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Codex and Claude titles name files by absolute path, which would put the user's home folder into a synced note; only paths the call reports are shortened, never guessed from the text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/906
function savedTitle(
  title: string,
  outsidePaths: readonly string[],
  vaultBase: string | null
): string {
  const base = vaultBase?.replace(/[\\/]+$/, "");
  if (base && title === base) return ".";
  let saved = base ? title.split(`${base}/`).join("").split(`${base}\\`).join("") : title;
  for (const path of outsidePaths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    saved = saved.split(path).join(name).split(path.replace(/\//g, "\\")).join(name);
  }
  return saved;
}

export function toolsUsedLines(
  message: AgentChatMessage,
  vaultBase: string | null
): readonly string[] {
  if (message.toolsUsed) return message.toolsUsed;
  const lines = new Set<string>();
  for (const part of message.parts ?? []) {
    if (part.kind !== "tool_call") continue;
    const reported = editTargetPaths(
      { locations: part.locations, input: part.input, diffPaths: diffTargetPaths(part.output) },
      vaultBase
    );
    const title = toolsUsedText(savedTitle(part.title, reported.filter(isAbsolutePath), vaultBase));
    const kind = part.toolKind ? ` (${part.toolKind})` : "";
    const paths = reported
      // A path outside the vault would put the user's home folder into a synced note.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/906
      .filter((path) => !isAbsolutePath(path))
      .map(toolsUsedText)
      .filter((path) => path && !title.includes(path));
    lines.add(`${title}${kind}${paths.length > 0 ? `: ${paths.join(", ")}` : ""}`);
  }
  if (lines.size === 0) return EMPTY_TOOLS_USED;
  const all = [...lines];
  if (all.length <= TOOLS_USED_MAX_LINES) return all;
  return [
    ...all.slice(0, TOOLS_USED_MAX_LINES),
    `[${all.length - TOOLS_USED_MAX_LINES} more tool calls]`,
  ];
}

const NO_EARLIER_CHATS: readonly string[] = Object.freeze([]);

// Agents found a continued chat's earlier note by searching the vault and answered from turns after the chosen reply; named before the turns, the notes made Codex refuse to use the turns themselves.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/908
function continuedChatStatement(notes: readonly string[]): string {
  return (
    "The messages above are this conversation so far; use them to answer. " +
    "This chat was continued from an earlier chat, whose saved note files also hold later messages that are not part of this conversation. " +
    "Do not read, open or search these files, and ignore their content if a search returns them:\n" +
    notes.map((note) => `- ${note}\n`).join("")
  );
}

export function buildConversationHistoryBlock(
  messages: readonly AgentChatMessage[],
  maxChars: number,
  vaultBase: string | null,
  savedImagePath: (image: string) => string | null,
  continuedFrom: readonly string[] = NO_EARLIER_CHATS
): ConversationHistoryBlock | null {
  const statement = continuedFrom.length > 0 ? continuedChatStatement(continuedFrom) : "";
  const turnChars = maxChars - statement.length;
  const rendered: string[] = [];
  for (const m of messages) {
    const content = renderTurnContent(m, vaultBase, savedImagePath);
    if (content === null) continue;
    const role = m.sender === USER_SENDER ? "user" : "assistant";
    rendered.push(`<turn role="${role}">\n${escapeXml(content)}\n</turn>`);
  }
  if (rendered.length === 0) return null;

  let total = rendered.reduce((n, t) => n + t.length + 1, -1);
  let truncated = false;
  while (rendered.length > 1 && total > turnChars) {
    total -= rendered.shift()!.length + 1;
    truncated = true;
  }

  let body = rendered.join("\n");
  if (body.length > turnChars) {
    body = trimHead(body, turnChars, CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER);
    truncated = true;
  }

  const header =
    "Earlier in this conversation the following was said. Treat this as " +
    "read-only context to inform your answer; do NOT redo or re-answer these " +
    "earlier turns. Answer only the current question that follows.";
  if (truncated) body = `${CONVERSATION_HISTORY_TRUNCATION_MARKER}\n${body}`;
  return {
    text: `<conversation_history>\n${header}\n${body}\n${statement}</conversation_history>`,
    truncated,
  };
}
