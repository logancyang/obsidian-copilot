const OPEN_TAG = "<user-message>";
const CLOSE_TAG = "</user-message>";

/**
 * Unwrap the `<user-message>…</user-message>` envelope a prompt is wrapped in
 * when the plugin prepends context blocks to it.
 *
 * A prompt that carries attached notes, project context, or web excerpts is sent
 * to the agent as `<context blocks>\n\n<user-message>what the user typed
 * </user-message>` — the wrapper exists so the model can tell the two apart. The
 * user never sees it live, because the visible message is created from the typed
 * text before the envelope is built. Any path that rebuilds the conversation from
 * what the *agent* stored gets the wrapped form instead, and has to undo it or
 * the restored bubble shows the whole context block as if the user had typed it.
 *
 * The envelope closes the prompt, so both tags are searched for from the end.
 * The context blocks in front of it inline whole note excerpts verbatim, so a
 * note that merely mentions `<user-message>` would otherwise be mistaken for
 * the wrapper and restore the user's bubble as the tail of that context. The
 * closing tag is taken last for the same reason, and because a prompt can be
 * stored with something after the envelope — the Claude adapter appends a note
 * in place of an image it cannot send, and the transcript hands both blocks
 * over as one string.
 *
 * The tags are not escaped, so this cannot be exact: a user who types
 * `<user-message>` into the composer loses everything before it. That is a
 * deliberate prompt, where an excerpt is any note the user attached, so the
 * larger surface wins.
 *
 * @param content - Stored prompt text, wrapped or not.
 * @returns What the user typed, or `content` unchanged when there is no wrapper
 *   (prompts sent without attached context are not wrapped).
 */
export function stripUserMessageWrapper(content: string): string {
  const end = content.lastIndexOf(CLOSE_TAG);
  const start = end === -1 ? -1 : content.lastIndexOf(OPEN_TAG, end);
  if (start === -1 || end <= start) return content;
  // The envelope puts the prompt on its own lines; those two are the wrapper's,
  // not the user's.
  return content
    .slice(start + OPEN_TAG.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

/**
 * The memory an agent brings to a turn: its curated core, and an index of the
 * conversations its recent daily notes record.
 *
 * The notes themselves are not here. They stay on disk, and the index carries
 * one line per conversation so the agent can tell whether a question reaches
 * into one and open that day itself (`designdocs/CUSTOM_AGENTS.md` §5,
 * "Reading").
 *
 * `modifiedAtMs` is the newest of the files behind the two, and dates the
 * `updated` attribute, which tells the model how old what it "remembers" is — a
 * three-month-old note about an ongoing draft should be weighed differently
 * from yesterday's.
 */
export interface AgentMemorySource {
  /** Body of `MEMORY.md`, or null when the agent has no curated core yet. */
  core: string | null;
  /** Rendered conversation index, or null when no recent day holds one. */
  index: string | null;
  modifiedAtMs: number;
}

/** Where an agent writes what it learns mid-turn, named in its persona block. */
export interface AgentMemoryWriteTargets {
  /** Vault-relative path of today's daily note, which the agent appends to. */
  dailyNotePath: string;
  /** Vault-relative `memory/` folder, which the agent reads older days from. */
  memoryFolderPath: string;
}

/** Everything the `<agent_persona>` block is rendered from. */
export interface AgentPersonaSource {
  /** Agent display name, used as the `name` attribute. */
  name: string;
  /** Body of `agent.md` — the standing instructions that are the persona. */
  instructions: string;
  /**
   * Where this agent may write, or null when it cannot: a read-only fan-out
   * sub-session has no write tool, so telling it to keep notes would only
   * produce a refusal (`designdocs/CUSTOM_AGENTS.md` §5).
   */
  writeTargets?: AgentMemoryWriteTargets | null;
}

/** `YYYY-MM-DD` in the user's own timezone — the `updated` attribute's format. */
function formatMemoryDate(modifiedAtMs: number): string {
  const date = new Date(modifiedAtMs);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Keep a name with a quote in it from breaking out of the attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

/**
 * The standing note-keeping instruction an agent that can write carries inside
 * its persona block.
 *
 * It names today's note rather than the folder because an agent given a folder
 * has to decide a file name, and two agents deciding differently would break
 * the one thing consolidation depends on: that a day of work is one dated file.
 * See `designdocs/CUSTOM_AGENTS.md` §5 ("Daily notes").
 */
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

/**
 * Render the `<agent_persona>` block a custom agent's chat carries in its FIRST
 * user message, beside `<project_context>`.
 *
 * Persona and memory are user data, so they cannot ride the product prompt:
 * that string is a provider cache prefix and has to stay byte-identical across
 * sessions. They cannot ride native `AGENTS.md` discovery either, because
 * discovery keys off the session working directory, which belongs to the scope
 * (vault root or project folder) rather than to the agent. The first user
 * message is past the cache wall and reaches all three backends identically.
 * See `designdocs/CUSTOM_AGENTS.md` §4 ("How the persona reaches the model").
 *
 * @param source - The agent's name, instructions, and where it may write.
 * @returns The block, or null when the agent contributes nothing — a named
 *   agent with an empty `agent.md` body and nowhere to write says nothing the
 *   model can act on, so it sends nothing rather than an empty tag pair.
 */
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

/**
 * The lines inside `<agent_memory>` that say what the agent is holding and how
 * to rank it. See {@link buildAgentMemoryBlock}.
 *
 * The recency line exists because the core is the longer and more
 * confident-sounding text while the index is the newer one: without being told,
 * a model asked what was decided today answers from the summary and reports the
 * day's own decision as still open.
 */
const MEMORY_RECENCY_NOTE =
  "This is your own recollection of this user. Where your recent conversations " +
  "differ from your consolidated summary, they are right and the summary has " +
  "not caught up yet.";

/**
 * The lines that tell the agent the index is a table of contents and where the
 * rest of each conversation is. Constant, so every agent is told the same thing.
 */
const MEMORY_INDEX_NOTE =
  "Your recent conversations below are an index, one line per conversation: " +
  "when it was, what it was called, and what it was about. The daily note each " +
  "line links to holds the rest of that conversation's bullets, and the chat " +
  "note saved in your conversations folder holds its transcript. Open either " +
  "with your file tools only when a question reaches back into a conversation " +
  "the index does not already answer.";

/** Heading of the section carrying the body of `MEMORY.md`. */
const MEMORY_CORE_LABEL = "Your consolidated summary";

/** Heading of the section carrying the conversation index. */
const MEMORY_INDEX_LABEL = "Your recent conversations";

/**
 * Render the `<agent_memory>` block carrying what the agent already knows: its
 * curated core, and an index of its recent conversations.
 *
 * Unlike the persona, this is re-sent whenever the files behind it change, so
 * a long chat sees what was written down during it rather than only what the
 * agent knew when the chat opened (`designdocs/CUSTOM_AGENTS.md` §5,
 * "Reading"). The two sections are labeled because they carry different weight
 * and the model cannot tell them apart otherwise, and the index is explained
 * because a line the agent reads as the whole of a conversation is worse than
 * no line: it would answer from a one-line summary rather than open the day.
 *
 * @param name - Agent display name, used as the `name` attribute.
 * @param memory - The core and the index, or null when the agent has neither.
 * @returns The block, or null when there is nothing to recall — an empty block
 *   would tell the model it remembers nothing, which is worse than silence.
 */
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
