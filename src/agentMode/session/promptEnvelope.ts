import {
  FANOUT_READONLY_PREAMBLE,
  prependPromptText,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { NewAgentChatMessage, PromptContent } from "@/agentMode/session/types";
import { USER_SENDER, WEB_SELECTED_TEXT_TAG } from "@/constants";
import { ContextProcessor } from "@/contextProcessor";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { formatDateTime } from "@/utils";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

const OPEN_TAG = "<user-message>";
const CLOSE_TAG = "</user-message>";

export function stripUserMessageWrapper(content: string): string {
  const end = content.lastIndexOf(CLOSE_TAG);
  const start = end === -1 ? -1 : content.lastIndexOf(OPEN_TAG, end);
  if (start === -1 || end <= start) return content;
  return content
    .slice(start + OPEN_TAG.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

export interface AgentMemorySource {
  core: string | null;
  index: string | null;
  modifiedAtMs: number;
}

export interface AgentMemoryWriteTargets {
  dailyNotePath: string;
  memoryFolderPath: string;
}

export interface AgentPersonaSource {
  name: string;
  instructions: string;
  writeTargets?: AgentMemoryWriteTargets | null;
}

function formatMemoryDate(modifiedAtMs: number): string {
  const date = new Date(modifiedAtMs);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function buildNoteKeepingInstruction(targets: AgentMemoryWriteTargets): string {
  return [
    "## Keeping your own notes",
    `When you learn something about this user worth keeping, append a bullet to ` +
      `\`${targets.dailyNotePath}\` with your file tools. Create it if it is not ` +
      `there. These are your notes to yourself, not a transcript.`,
    `Your notes are in \`${targets.memoryFolderPath}\`, one file per day. You are ` +
      `given an index of the conversations they record, not the notes themselves, ` +
      `so open a day's file when a question reaches past what its index line says.`,
    "Never edit your MEMORY.md. It is rewritten from these notes by a separate " +
      "pass, and an edit of yours would be overwritten.",
  ].join("\n");
}

export function buildAgentPersonaBlock(source: AgentPersonaSource): string | null {
  const name = source.name.trim();
  const instructions = source.instructions.trim();
  const targets = source.writeTargets ?? null;
  if (!name || (!instructions && !targets)) return null;
  const body = [instructions, targets ? buildNoteKeepingInstruction(targets) : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return `<agent_persona name="${escapeAttribute(name)}">\n${body}\n</agent_persona>`;
}

const MEMORY_RECENCY_NOTE =
  "This is your own recollection of this user. Where your recent conversations " +
  "differ from your consolidated summary, they are right and the summary has " +
  "not caught up yet.";

const MEMORY_INDEX_NOTE =
  "Your recent conversations below are an index, one line per conversation: " +
  "when it was, what it was called, and what it was about. The daily note each " +
  "line links to holds the rest of that conversation's bullets, and the chat " +
  "note saved in your conversations folder holds its transcript. Open either " +
  "with your file tools only when a question reaches back into a conversation " +
  "the index does not already answer.";

const MEMORY_CORE_LABEL = "Your consolidated summary";

const MEMORY_INDEX_LABEL = "Your recent conversations";

export function buildAgentMemoryBlock(
  name: string,
  memory: AgentMemorySource | null
): string | null {
  const attrName = name.trim();
  const core = memory?.core?.trim() ?? "";
  const index = memory?.index?.trim() ?? "";
  if (!attrName || (!core && !index)) return null;
  const updated = formatMemoryDate(memory!.modifiedAtMs);
  const updatedAttr = updated ? ` updated="${updated}"` : "";
  const body = [
    MEMORY_RECENCY_NOTE,
    index ? MEMORY_INDEX_NOTE : "",
    core ? `## ${MEMORY_CORE_LABEL}\n${core}` : "",
    index ? `## ${MEMORY_INDEX_LABEL}\n${index}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return `<agent_memory name="${escapeAttribute(attrName)}"${updatedAttr}>\n${body}\n</agent_memory>`;
}

// Some agents end the turn when a reply is cut off, mid tool call or mid text, so the plugin hands the cause back once. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
export const OUTPUT_LIMIT_CONTINUATION_PROMPT =
  "Your last reply hit the output limit and was cut off, so any unfinished step did not run. Continue in smaller steps without recapping.";

type DisplayContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildUserDisplayContent(
  displayText: string,
  promptContent?: PromptContent[]
): DisplayContentItem[] | undefined {
  const images = (promptContent ?? []).filter(
    (p): p is Extract<PromptContent, { type: "image" }> => p.type === "image"
  );
  if (images.length === 0) return undefined;
  const content: DisplayContentItem[] = [];
  if (displayText.trim()) content.push({ type: "text", text: displayText });
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    });
  }
  return content;
}

export function buildUserMessage(
  id: string,
  text: string,
  context: MessageContext | undefined,
  promptContent: PromptContent[] | undefined
): NewAgentChatMessage {
  return {
    id,
    message: text,
    sender: USER_SENDER,
    timestamp: formatDateTime(new Date()),
    isVisible: true,
    context,
    content: buildUserDisplayContent(text, promptContent),
  };
}

export function buildPromptBlocks(
  displayText: string,
  context?: MessageContext,
  content?: PromptContent[],
  webTabBlock?: string,
  projectContextBlock?: string | null,
  leadingContextBlock?: string | null,
  projectContextUpdatesBlock?: string | null,
  leadBlock?: string | null
): PromptContent[] {
  const sections = [
    leadBlock?.trim() || null,
    projectContextBlock?.trim() || null,
    projectContextUpdatesBlock?.trim() || null,
    leadingContextBlock?.trim() || null,
    buildContextEnvelope(context),
    buildWebSelectionBlocks(context),
    webTabBlock?.trim() || null,
  ].filter((s): s is string => Boolean(s));
  const head = sections.length > 0 ? sections.join("\n\n") : null;
  const headText = head
    ? `${head}\n\n<user-message>\n${displayText}\n</user-message>`
    : displayText;
  const extras = content ?? [];
  if (extras.length === 0) return [{ type: "text", text: headText }];
  return [{ type: "text", text: headText }, ...extras];
}

export function withReadOnlyPreamble(blocks: PromptContent[]): PromptContent[] {
  return prependPromptText(blocks, FANOUT_READONLY_PREAMBLE);
}

export async function serializeWebTabContext(context: MessageContext | undefined): Promise<string> {
  const webTabs = context?.webTabs;
  if (!webTabs || webTabs.length === 0) return "";
  return (await ContextProcessor.getInstance().processContextWebTabs(webTabs)).trim();
}

function buildWebSelectionBlocks(context: MessageContext | undefined): string | null {
  const selections = (context?.selectedTextContexts ?? []).filter(isWebSelectedTextContext);
  if (selections.length === 0) return null;
  return selections
    .map((s) =>
      [
        `<${WEB_SELECTED_TEXT_TAG}>`,
        `<title>${escapeXml(s.title)}</title>`,
        `<url>${escapeXml(s.url)}</url>`,
        `<content>\n${escapeXml(s.content)}\n</content>`,
        `</${WEB_SELECTED_TEXT_TAG}>`,
      ].join("\n")
    )
    .join("\n\n");
}

function buildContextEnvelope(context: MessageContext | undefined): string | null {
  if (!context) return null;
  const notePaths = (context.notes ?? []).map((n) => n.path).filter(Boolean);
  const excerpts = (context.selectedTextContexts ?? []).filter(isNoteSelectedTextContext);
  if (notePaths.length === 0 && excerpts.length === 0) return null;

  const lines: string[] = [
    "<copilot-context>",
    "The user attached the following vault items as context. The vault is your current working directory; open them if you need their contents.",
  ];
  if (notePaths.length > 0) {
    lines.push("", "Notes:");
    for (const p of notePaths) lines.push(`- ${p}`);
  }
  if (excerpts.length > 0) {
    lines.push("", "Selected excerpts (already inlined; no need to re-read):");
    for (const e of excerpts) {
      const location = e.startLine > 0 ? ` (lines ${e.startLine}-${e.endLine})` : "";
      lines.push(`- ${e.notePath}${location}:`);
      for (const l of e.content.split("\n")) lines.push(`  ${l}`);
    }
  }
  lines.push("</copilot-context>");
  return lines.join("\n");
}

export function extractText(content: PromptContent): string {
  if (content.type === "text") return content.text;
  return "";
}
