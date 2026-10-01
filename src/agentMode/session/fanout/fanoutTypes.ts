import type {
  AgentChatMessage,
  AgentToolKind,
  BackendId,
  PromptContent,
} from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

export const FANOUT_READONLY_PREAMBLE =
  "You are answering a read-only question. Do NOT modify any files, run any " +
  "commands that change state, or execute write/shell tools — answer only. " +
  "You may freely read, search, grep, and fetch to inform your answer. " +
  "Respond with your analysis directly.";

export interface FanoutTurn {
  answers: Record<BackendId, AgentAnswer>;
  summary: FanoutSummary;
}

/**
 * A one-answer turn with persisted summary text predates direct routing and keeps that summary.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/481
 */
export function isDirectAnswerTurn(turn: FanoutTurn): boolean {
  return Object.keys(turn.answers).length === 1 && turn.summary.text.trim().length === 0;
}

export type AgentAnswerStatus = "running" | "done" | "error" | "cancelled";

export interface AgentAnswer {
  backendId: BackendId;
  status: AgentAnswerStatus;
  text: string;
  error?: string;
}

export const FANOUT_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

export const FANOUT_AGENT_TIMEOUT_ERROR = "Timed out waiting for this agent to answer.";

export const FANOUT_CANCEL_GRACE_MS = 3 * 1000;

export const FANOUT_TRAILING_CHUNK_GRACE_MS = 500;

export type FanoutSummaryStatus = "pending" | "streaming" | "done";

export interface FanoutSummary {
  status: FanoutSummaryStatus;
  text: string;
  error?: string;
  complete?: boolean;
}

const VAULT_WRITE_KINDS: ReadonlySet<AgentToolKind> = new Set<AgentToolKind>([
  "edit",
  "delete",
  "move",
]);

export function isVaultWriteToolKind(kind: AgentToolKind | undefined): boolean {
  if (kind === undefined) return true;
  return VAULT_WRITE_KINDS.has(kind);
}

export function snapshotFanoutTurn(turn: FanoutTurn): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of Object.keys(turn.answers)) {
    answers[backendId] = { ...turn.answers[backendId] };
  }
  return { answers, summary: { ...turn.summary } };
}

export const FANOUT_SUMMARY_INSTRUCTION =
  "You are a neutral synthesizer. The labeled blocks below are what SEVERAL " +
  "DIFFERENT AI agents each produced in response to the user's request. Write a " +
  "synthesis for the user ABOUT their outputs — you are reporting on what the " +
  "agents produced, not doing the task yourself.\n\n" +
  "VOICE (always):\n" +
  "- Third person, attributing each point to the agent by name (convert the " +
  'agents\' "I/my" into "<agent> …"). NEVER write in the first person or as if ' +
  'the request were made of you; no sentence may begin with "I".\n' +
  "- Use ONLY the outputs shown; ignore any environment scaffolding (tool lists, " +
  "available skills/agents, boilerplate). Do not mention how many agents there " +
  "were, who did not respond, or anything missing.\n\n" +
  "FORMAT (always): clean, scannable Markdown, and be concise. Lead with the " +
  "bottom line in one or two sentences, THEN the sections below as `###` " +
  "subheadings — each on its own line, preceded by a blank line, with one or two " +
  "short paragraphs under it. Do NOT pack points into dense bullet lists; prefer " +
  "short paragraphs and whitespace, and use a bullet list only for 3+ genuinely " +
  "parallel items, one line each, never nested.\n\n" +
  "FIRST pick the MODE from the request and the outputs:\n" +
  "- ANSWER mode — the agents answered a question or analyzed something (facts, " +
  "explanation, a recommendation, identity); there is a best answer to converge " +
  "on.\n" +
  "- DELIVERABLE mode — the agents each produced an ALTERNATIVE ARTIFACT the user " +
  "will choose from or use (a rewrite, draft, message, translation, code, plan, " +
  "design); these are options, not competing claims.\n\n" +
  "If only ONE agent responded (either mode): one to three sentences on its " +
  "answer or approach, attributed, no headings.\n\n" +
  "TWO OR MORE in ANSWER mode — lead with the bottom line, then these `###` " +
  "sections, omitting any that would be empty:\n" +
  "  ### Each agent\n" +
  "  A short attributed paragraph for each agent's take.\n" +
  "  ### Agreements\n" +
  "  The points the agents share.\n" +
  "  ### Disagreements\n" +
  "  Where they differ, naming the sides.\n\n" +
  "TWO OR MORE in DELIVERABLE mode — lead with the bottom line, then help the " +
  "user CHOOSE or MERGE (NOT agreements/disagreements), as `###` sections:\n" +
  "  ### Options\n" +
  "  A short attributed paragraph per agent on what is DISTINCTIVE about its " +
  "take — the angle, tone, structure, or tradeoff that would make someone pick " +
  "it, and who it suits.\n" +
  "  ### Recommendation\n" +
  "  Name the best option for the likely goal and why; if a combination is " +
  "clearly better, say which parts of which to merge.\n" +
  "  Do NOT reproduce the artifacts (the user already has each in its own tab); " +
  "describe the approach only.\n\n" +
  "Do NOT modify any files or run write/shell tools.";

export const FANOUT_ALL_FAILED_SUMMARY =
  "All agents failed to answer; no summary could be generated.";

export interface PendingFanoutContext {
  question: string;
  summary: string;
}

export function buildPriorFanoutContextBlock(
  entries: ReadonlyArray<PendingFanoutContext>
): string | null {
  if (entries.length === 0) return null;
  const turns = entries
    .map(
      (e) =>
        `<multi_agent_turn>\n<question>\n${escapeXml(e.question)}\n</question>\n` +
        `<summary>\n${escapeXml(e.summary)}\n</summary>\n</multi_agent_turn>`
    )
    .join("\n");
  return (
    "<prior_turns>\n" +
    "Earlier in this conversation you ran the following multi-agent turn(s). " +
    "Each shows the user's question and the summary that was already shown to " +
    "the user. Treat these as conversation history for continuity; do not " +
    "redo or re-answer them.\n" +
    `${turns}\n` +
    "</prior_turns>"
  );
}

export const FANOUT_HISTORY_MAX_CHARS = 48_000;

const FANOUT_HISTORY_TRUNCATION_MARKER = "[earlier conversation truncated]";

const FANOUT_HISTORY_TURN_TRUNCATION_MARKER = "[turn truncated]";

const FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;

function trimHead(s: string, max: number, marker: string): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n${marker}`;
}

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
      FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS,
      FANOUT_HISTORY_TURN_TRUNCATION_MARKER
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
    body = trimHead(body, maxChars, FANOUT_HISTORY_TURN_TRUNCATION_MARKER);
    truncated = true;
  }

  const header =
    "Earlier in this conversation the following was said. Treat this as " +
    "read-only context to inform your answer; do NOT redo or re-answer these " +
    "earlier turns. Answer only the current question that follows.";
  if (truncated) body = `${FANOUT_HISTORY_TRUNCATION_MARKER}\n${body}`;
  return `<conversation_history>\n${header}\n${body}\n</conversation_history>`;
}

export interface SucceededAnswer {
  backendId: BackendId;
  text: string;
}

export interface SummaryInputs {
  succeeded: SucceededAnswer[];
  failed: BackendId[];
}

export function selectSummaryInputs(turn: FanoutTurn): SummaryInputs {
  const succeeded: SucceededAnswer[] = [];
  const failed: BackendId[] = [];
  for (const backendId of Object.keys(turn.answers)) {
    const slot = turn.answers[backendId];
    const text = slot.text.trim();
    if (slot.status === "done" && text.length > 0) {
      succeeded.push({ backendId, text });
    } else {
      failed.push(backendId);
    }
  }
  return { succeeded, failed };
}

const FANOUT_SUMMARY_ANSWER_MAX_CHARS = 12_000;
const FANOUT_SUMMARY_ANSWER_TRUNCATION_MARKER = "[answer truncated]";

export function buildSummaryUserPrompt(
  originalPrompt: string,
  inputs: SummaryInputs,
  displayNameFor: (backendId: BackendId) => string
): PromptContent[] | null {
  if (inputs.succeeded.length === 0) return null;
  const sections = inputs.succeeded.map(
    ({ backendId, text }) =>
      `### ${displayNameFor(backendId)}\n${trimHead(text, FANOUT_SUMMARY_ANSWER_MAX_CHARS, FANOUT_SUMMARY_ANSWER_TRUNCATION_MARKER)}`
  );
  const parts = [
    FANOUT_SUMMARY_INSTRUCTION,
    `## Question\n${originalPrompt.trim()}`,
    `## Agent answers\n${sections.join("\n\n")}`,
  ];
  return [{ type: "text", text: parts.join("\n\n") }];
}

export const FANOUT_PERSISTED_ANSWER_MAX_CHARS = 24_000;

const FANOUT_PERSISTED_ANSWER_TRUNCATION_MARKER = "[answer truncated]";

const FANOUT_COMPOSITE_VERSION = 1;

const FANOUT_MARKER_OPEN = `<!--copilot:multi-agent v=${FANOUT_COMPOSITE_VERSION}-->`;

const FANOUT_MARKER_OPEN_RE = /<!--copilot:multi-agent v=\d+-->/;

const FANOUT_MARKER_CLOSE = "<!--copilot:multi-agent-end-->";

const FANOUT_MARKER_SUMMARY = "<!--copilot:summary-->";

const FANOUT_MARKER_SENTINEL = "\uE000";
const FANOUT_SENTINEL_LITERAL_ESCAPE = `${FANOUT_MARKER_SENTINEL}0`;
const FANOUT_SENTINEL_COLON_ESCAPE = `${FANOUT_MARKER_SENTINEL}1`;
const FANOUT_LITERAL_MARKER_PREFIX = "<!--copilot:";
const FANOUT_ESCAPED_MARKER_PREFIX = `<!--copilot${FANOUT_SENTINEL_COLON_ESCAPE}`;

function escapeFanoutMarkers(text: string): string {
  return text
    .split(FANOUT_MARKER_SENTINEL)
    .join(FANOUT_SENTINEL_LITERAL_ESCAPE)
    .split(FANOUT_LITERAL_MARKER_PREFIX)
    .join(FANOUT_ESCAPED_MARKER_PREFIX);
}

function unescapeFanoutMarkers(text: string): string {
  return text
    .split(FANOUT_ESCAPED_MARKER_PREFIX)
    .join(FANOUT_LITERAL_MARKER_PREFIX)
    .split(FANOUT_SENTINEL_LITERAL_ESCAPE)
    .join(FANOUT_MARKER_SENTINEL);
}

function capPersistedAnswer(text: string): string {
  if (text.length <= FANOUT_PERSISTED_ANSWER_MAX_CHARS) return text;
  return `${text.slice(0, FANOUT_PERSISTED_ANSWER_MAX_CHARS)}\n${FANOUT_PERSISTED_ANSWER_TRUNCATION_MARKER}`;
}

const FANOUT_NO_ANSWER_NOTE = "did not answer";

export function serializeFanoutComposite(
  turn: FanoutTurn,
  displayName: (backendId: BackendId) => string
): string {
  const { succeeded } = selectSummaryInputs(turn);
  const succeededIds = new Set(succeeded.map((s) => s.backendId));
  const summaryText = turn.summary.text.trim();
  const shouldCapAnswers = !isDirectAnswerTurn(turn);

  const lines: string[] = [FANOUT_MARKER_OPEN, FANOUT_MARKER_SUMMARY, "### Summary"];
  if (summaryText.length > 0) lines.push(escapeFanoutMarkers(summaryText));

  for (const backendId of Object.keys(turn.answers)) {
    const name = displayName(backendId);
    const nameAttr = ` name="${escapeMarkerAttr(name)}"`;
    const slot = turn.answers[backendId];
    if (succeededIds.has(backendId)) {
      lines.push(
        `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr} status="done"-->`,
        `### ${name}`,
        escapeFanoutMarkers(
          shouldCapAnswers ? capPersistedAnswer(slot.text.trim()) : slot.text.trim()
        )
      );
    } else {
      const errorAttr =
        slot.status === "error" && slot.error ? ` error="${escapeMarkerAttr(slot.error)}"` : "";
      const statusAttr = ` status="${escapeMarkerAttr(slot.status)}"`;
      const partial = slot.text.trim();
      if (partial.length > 0) {
        lines.push(
          `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr}${statusAttr}${errorAttr}-->`,
          `### ${name}`,
          escapeFanoutMarkers(shouldCapAnswers ? capPersistedAnswer(partial) : partial)
        );
      } else {
        lines.push(
          `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr}${statusAttr}${errorAttr} note="${FANOUT_NO_ANSWER_NOTE}"-->`
        );
      }
    }
  }

  lines.push(FANOUT_MARKER_CLOSE);
  return lines.join("\n");
}

export function renderFanoutComposite(
  turn: FanoutTurn,
  displayName: (backendId: BackendId) => string
): string {
  const { succeeded } = selectSummaryInputs(turn);
  const succeededIds = new Set(succeeded.map((s) => s.backendId));
  const sections: string[] = [];

  const summaryText = turn.summary.text.trim();
  // A single direct answer has no synthesized summary, so continuity replay and
  // copy output should not invent an empty Summary section.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
  if (!isDirectAnswerTurn(turn)) {
    sections.push(summaryText.length > 0 ? `### Summary\n${summaryText}` : "### Summary");
  }

  for (const backendId of Object.keys(turn.answers)) {
    const name = displayName(backendId);
    const slot = turn.answers[backendId];
    if (succeededIds.has(backendId)) {
      sections.push(`### ${name}\n${slot.text.trim()}`);
    } else {
      const partial = slot.text.trim();
      sections.push(
        partial.length > 0 ? `### ${name}\n${partial}` : `### ${name}\n_${FANOUT_NO_ANSWER_NOTE}_`
      );
    }
  }

  return sections.join("\n\n");
}

function escapeMarkerAttr(value: string): string {
  return value.replace(/--/g, "—").replace(/"/g, "'").replace(/>/g, "›");
}

function readMarkerAttr(marker: string, key: string): string | undefined {
  const match = marker.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1] : undefined;
}

function statusFromMarker(raw: string | undefined): AgentAnswerStatus {
  if (raw === "done" || raw === "error" || raw === "cancelled") return raw;
  return "error";
}

export function parseFanoutComposite(body: string): FanoutTurn | null {
  if (!FANOUT_MARKER_OPEN_RE.test(body) || !body.includes(FANOUT_MARKER_CLOSE)) return null;

  const answers: Record<BackendId, AgentAnswer> = {};
  let summaryText = "";

  const markerRe = /<!--copilot:(summary|agent[^>]*|multi-agent(?:-end)?[^>]*)-->/g;
  type Section = { marker: string; body: string };
  const sections: Section[] = [];
  let match: RegExpExecArray | null;
  let lastMarker: string | null = null;
  let lastIndex = 0;
  while ((match = markerRe.exec(body)) !== null) {
    if (lastMarker !== null) {
      sections.push({ marker: lastMarker, body: body.slice(lastIndex, match.index) });
    }
    lastMarker = match[0];
    lastIndex = markerRe.lastIndex;
  }
  if (lastMarker !== null) sections.push({ marker: lastMarker, body: body.slice(lastIndex) });

  for (const section of sections) {
    if (section.marker.startsWith("<!--copilot:multi-agent")) continue;
    const inner = stripLeadingHeading(unescapeFanoutMarkers(section.body)).trim();
    if (section.marker === FANOUT_MARKER_SUMMARY) {
      summaryText = inner;
      continue;
    }
    const id = readMarkerAttr(section.marker, "id");
    if (!id) continue;
    const status = statusFromMarker(readMarkerAttr(section.marker, "status"));
    const note = readMarkerAttr(section.marker, "note");
    const errorReason = readMarkerAttr(section.marker, "error");
    answers[id] = {
      backendId: id,
      status,
      text: note !== undefined ? "" : inner,
      ...(errorReason !== undefined ? { error: errorReason } : {}),
    };
  }

  if (summaryText.length === 0 && Object.keys(answers).length === 0) return null;

  return { answers, summary: { status: "done", text: summaryText } };
}

function stripLeadingHeading(sectionBody: string): string {
  const lines = sectionBody.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i < lines.length && /^#{1,6}\s/.test(lines[i].trim())) {
    return lines.slice(i + 1).join("\n");
  }
  return sectionBody;
}
