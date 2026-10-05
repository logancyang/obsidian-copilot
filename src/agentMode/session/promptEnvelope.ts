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
  scratchpad: string | null;
  modifiedAtMs: number;
}

export interface AgentMemoryWriteTargets {
  dailyNotePath: string;
  memoryFolderPath: string;
  scratchpadPath: string;
  agentFolderPath: string;
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

function buildScratchpadInstruction(targets: AgentMemoryWriteTargets): string {
  return [
    "## Keeping your scratchpad",
    `\`${targets.scratchpadPath}\` is your scratchpad: the index page of the work ` +
      `you keep for this user. You are shown it at the start of every conversation, ` +
      `so it is how you pick up where you left off, and the user opens it to see ` +
      `what you are tracking. Create it the first time you take on something worth ` +
      `tracking, and update it with your file tools before you finish any turn that ` +
      `changes what it says.`,
    [
      "- Open with a line or two on what you are focused on now.",
      "- Keep open threads, what you are tracking or owe the user, as a checklist. " +
        "Check an item off when it is done and drop it once it no longer matters.",
      "- Link every file you maintain for this user, such as boards, drafts, designs " +
        `and reports, with one line on what each is for. Keep them in ` +
        `\`${targets.agentFolderPath}\` unless the user names another place, and ` +
        "open them when the work needs them rather than copying them in.",
      "- Link the daily notes behind an open thread instead of repeating them. " +
        "What you learn about the user still goes in your daily notes.",
      "- When a set of your files is easier to scan as a table or board, keep a " +
        "Bases view of it in your folder and embed it here.",
    ].join("\n"),
    "Keep it an index that reads in a minute, not a log. Write it as a page the " +
      "user would want to open: headings, links, and nothing stale.",
  ].join("\n");
}

export function buildAgentPersonaBlock(source: AgentPersonaSource): string | null {
  const name = source.name.trim();
  const instructions = source.instructions.trim();
  const targets = source.writeTargets ?? null;
  if (!name || (!instructions && !targets)) return null;
  const body = [
    instructions,
    targets ? buildNoteKeepingInstruction(targets) : "",
    targets ? buildScratchpadInstruction(targets) : "",
  ]
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

const MEMORY_SCRATCHPAD_LABEL = "Your scratchpad";

const MEMORY_CORE_LABEL = "Your consolidated summary";

const MEMORY_INDEX_LABEL = "Your recent conversations";

export function buildAgentMemoryBlock(
  name: string,
  memory: AgentMemorySource | null
): string | null {
  const attrName = name.trim();
  const core = memory?.core?.trim() ?? "";
  const index = memory?.index?.trim() ?? "";
  const scratchpad = memory?.scratchpad?.trim() ?? "";
  if (!attrName || (!core && !index && !scratchpad)) return null;
  const updated = formatMemoryDate(memory!.modifiedAtMs);
  const updatedAttr = updated ? ` updated="${updated}"` : "";
  const body = [
    MEMORY_RECENCY_NOTE,
    index ? MEMORY_INDEX_NOTE : "",
    scratchpad ? `## ${MEMORY_SCRATCHPAD_LABEL}\n${scratchpad}` : "",
    core ? `## ${MEMORY_CORE_LABEL}\n${core}` : "",
    index ? `## ${MEMORY_INDEX_LABEL}\n${index}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return `<agent_memory name="${escapeAttribute(attrName)}"${updatedAttr}>\n${body}\n</agent_memory>`;
}
