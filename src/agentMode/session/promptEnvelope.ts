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
