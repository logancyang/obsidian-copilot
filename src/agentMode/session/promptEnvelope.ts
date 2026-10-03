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
