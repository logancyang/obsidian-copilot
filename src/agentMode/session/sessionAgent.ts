import type { AgentFileManager } from "@/agents/AgentFileManager";
import { formatMissingAgentLabel } from "@/agents/agentDisplay";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { hashMemoryContent } from "@/agents/agentMemoryFile";
import { agentMemoryIndexCutoff, buildAgentMemoryIndex } from "@/agents/agentMemoryIndex";
import { BUILTIN_AGENT, type CustomAgent } from "@/agents/types";
import { buildAgentMemoryBlock, buildAgentPersonaBlock } from "@/agentMode/session/promptEnvelope";
import { logWarn } from "@/logger";

/**
 * Who one chat is talking to, resolved once and carried by the session.
 *
 * Everything here is decided at the same moment and must not drift apart: what
 * the chat persists (`slug`), what its tab and recent-list row say (`name`,
 * `icon`), what its first user message carries (`personaBlock`), and what the
 * agent knew when it was read (`memory`). See `designdocs/CUSTOM_AGENTS.md`
 * §3–§5.
 */
export interface SessionAgent {
  /** Slug to persist, or null for the built-in Copilot, which persists nothing. */
  slug: string | null;
  /** Display name for the tab, the picker trigger, and the recent-list row. */
  name: string;
  /** The agent's emoji. Empty when the agent set none, or when it is gone. */
  icon: string;
  /** Rendered `<agent_persona>` block for the first user message; null for Copilot. */
  personaBlock: string | null;
  /**
   * What the agent remembers as of the last read, or null when it has no
   * memory. It travels with the identity so every path that binds a chat to an
   * agent binds what that agent knows at the same moment, but a chat re-sends
   * it on its own schedule rather than once (§5, "Reading").
   */
  memory: AgentMemoryInjection | null;
}

/**
 * What an agent currently remembers, ready to prepend to a user message.
 *
 * The fingerprint identifies the block itself, so a chat can tell whether what
 * it already sent is still current without re-reading anything. It keys on the
 * rendered text rather than on the files behind it, so a bullet appended below
 * a conversation's first one — which the index does not show — does not cost
 * every later turn a re-send of an identical block
 * (`designdocs/CUSTOM_AGENTS.md` §5, "Reading").
 */
export interface AgentMemoryInjection {
  /** The rendered `<agent_memory>` block. */
  block: string;
  /** Identity of `block`; an unchanged one means nothing to re-send. */
  fingerprint: string;
}

/**
 * The default answerer: today's assistant, product prompt plus `AGENTS.md`, no
 * persona and no memory. Frozen — it is a constant, not per-vault state.
 */
export const COPILOT_SESSION_AGENT: SessionAgent = Object.freeze({
  slug: null,
  name: BUILTIN_AGENT.name,
  icon: BUILTIN_AGENT.icon,
  personaBlock: null,
  memory: null,
});

/**
 * Read what an agent currently remembers: its curated core, and an index of the
 * conversations its recent daily notes record.
 *
 * The notes themselves are not read into the turn. A fortnight of them would
 * crowd out the conversation, and most of what they hold is not what the
 * current question is about, so the agent is given the table of contents and
 * opens a day itself when a question reaches into one. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Reading").
 *
 * @param files - Reader for the agent folder.
 * @param agent - The agent whose memory is read.
 * @param now - Clock, passed in so the index window is testable.
 */
export async function loadAgentMemoryInjection(
  files: AgentFileManager,
  agent: CustomAgent,
  now: Date = new Date()
): Promise<AgentMemoryInjection | null> {
  if (!agent.memoryEnabled) return null;
  try {
    const core = await files.readMemoryDocument(agent.slug);
    const notes = await files.readDailyNotesAfter(agent.slug, agentMemoryIndexCutoff(now));
    const modifiedAtMs = Math.max(
      core?.modifiedAtMs ?? 0,
      ...notes.map((note) => note.modifiedAtMs)
    );

    const block = buildAgentMemoryBlock(agent.name, {
      core: core?.body ?? null,
      index: buildAgentMemoryIndex(notes),
      modifiedAtMs,
    });
    return block ? { block, fingerprint: hashMemoryContent(block) } : null;
  } catch (error) {
    // Unreadable memory must not stop the user talking to the agent; it answers
    // in character with nothing recalled.
    logWarn(`[Agents] Could not read memory for "${agent.slug}"`, error);
    return null;
  }
}

/**
 * Resolve a custom agent into the form a session holds: its identity and
 * persona block, and what it remembers right now.
 *
 * @param files - Reader for the agent folder.
 * @param agent - The agent the chat is being bound to.
 * @param options - `writable` is false for a read-only fan-out sub-session,
 *   which has no file tools and so is not told to keep notes.
 */
export async function loadSessionAgent(
  files: AgentFileManager,
  agent: CustomAgent,
  options: { writable?: boolean } = {}
): Promise<SessionAgent> {
  const writable = options.writable !== false;
  const writeTargets =
    writable && agent.memoryEnabled
      ? {
          dailyNotePath: files.getDailyNotePath(agent.slug, formatMemoryEntryDate(new Date())),
          memoryFolderPath: files.getMemoryFolderPath(agent.slug),
        }
      : null;
  return {
    slug: agent.slug,
    name: agent.name,
    icon: agent.icon,
    personaBlock: buildAgentPersonaBlock({
      name: agent.name,
      instructions: agent.instructions,
      writeTargets,
    }),
    memory: await loadAgentMemoryInjection(files, agent),
  };
}

/**
 * The stand-in for a chat whose agent has been deleted: the name stays, so the
 * user can see who the conversation was held with, but nothing is sent and the
 * chat runs as the default assistant. See `designdocs/CUSTOM_AGENTS.md` §1.
 *
 * @param slug - Slug the chat persisted, which no longer resolves to a folder.
 */
export function missingSessionAgent(slug: string): SessionAgent {
  return { slug, name: formatMissingAgentLabel(slug), icon: "", personaBlock: null, memory: null };
}
