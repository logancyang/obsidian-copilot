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
 * The memory file an agent brings to a conversation.
 *
 * `modifiedAtMs` dates the `updated` attribute, which tells the model how old
 * what it "remembers" is — a three-month-old note about an ongoing draft should
 * be weighed differently from yesterday's.
 */
export interface AgentMemorySource {
  text: string;
  modifiedAtMs: number;
}

/** Everything the persona blocks are rendered from. */
export interface AgentPersonaSource {
  /** Agent display name, used as the `name` attribute of both blocks. */
  name: string;
  /** Body of `agent.md` — the standing instructions that are the persona. */
  instructions: string;
  /**
   * Contents of `MEMORY.md`, or null when the agent's memory toggle is off or
   * the file is absent. Absent memory emits no block at all, so the model is
   * never told it remembers nothing.
   */
  memory?: AgentMemorySource | null;
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
 * Render the `<agent_persona>` and `<agent_memory>` blocks a custom agent's
 * chat carries in its FIRST user message, beside `<project_context>`.
 *
 * Persona and memory are user data, so they cannot ride the product prompt:
 * that string is a provider cache prefix and has to stay byte-identical across
 * sessions. They cannot ride native `AGENTS.md` discovery either, because
 * discovery keys off the session working directory, which belongs to the scope
 * (vault root or project folder) rather than to the agent. The first user
 * message is past the cache wall and reaches all three backends identically.
 * See `designdocs/CUSTOM_AGENTS.md` §4 ("How the persona reaches the model").
 *
 * @param source - The agent's name, instructions, and optional memory file.
 * @returns The blocks, or null when the agent contributes neither — a named
 *   agent with an empty `agent.md` body and no memory says nothing the model
 *   can act on, so it sends nothing rather than an empty tag pair.
 */
export function buildAgentPersonaBlocks(source: AgentPersonaSource): string | null {
  const name = source.name.trim();
  const instructions = source.instructions.trim();
  const memory = source.memory ?? null;
  const memoryText = memory?.text.trim() ?? "";
  if (!name || (!instructions && !memoryText)) return null;

  const attrName = escapeAttribute(name);
  const blocks = [`<agent_persona name="${attrName}">\n${instructions}\n</agent_persona>`];
  if (memory && memoryText) {
    const updated = formatMemoryDate(memory.modifiedAtMs);
    const updatedAttr = updated ? ` updated="${updated}"` : "";
    blocks.push(`<agent_memory name="${attrName}"${updatedAttr}>\n${memoryText}\n</agent_memory>`);
  }
  return blocks.join("\n\n");
}
