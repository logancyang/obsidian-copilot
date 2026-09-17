/**
 * File names inside one agent's folder. `agent.md` is the user-owned identity
 * record; `MEMORY.md` is the agent's own notebook. Both are fixed, so an agent
 * folder is recognizable by name alone and a hand-renamed file simply stops
 * being an agent rather than silently becoming a different one.
 */
export const AGENT_FILE_NAME = "agent.md";
export const AGENT_MEMORY_FILE_NAME = "MEMORY.md";

/**
 * Frontmatter keys of `agent.md`. Namespaced with `copilot-agent-` for the same
 * reason the project keys are: an agent note sits in the user's vault, where a
 * bare `name` or `icon` property would collide with their own conventions and
 * with other plugins' property schemas.
 */
export const COPILOT_AGENT_NAME = "copilot-agent-name";
export const COPILOT_AGENT_DESCRIPTION = "copilot-agent-description";
export const COPILOT_AGENT_ICON = "copilot-agent-icon";
export const COPILOT_AGENT_BACKEND = "copilot-agent-backend";
export const COPILOT_AGENT_MODEL = "copilot-agent-model";
export const COPILOT_AGENT_EFFORT = "copilot-agent-effort";
export const COPILOT_AGENT_MEMORY = "copilot-agent-memory";
export const COPILOT_AGENT_CREATED = "copilot-agent-created";

/**
 * Folder of dated daily notes inside one agent's folder — the episodic tier the
 * agent and the flush pass both append to. Consolidation reads it and rewrites
 * `MEMORY.md` from what it finds. See `designdocs/CUSTOM_AGENTS.md` §5.
 */
export const AGENT_MEMORY_FOLDER_NAME = "memory";

/**
 * Frontmatter key of `MEMORY.md` recording the last daily note consolidation
 * folded in, so the next pass reads only what is newer. Not namespaced like the
 * `agent.md` keys: `MEMORY.md` is Copilot's own file, not a user record that
 * shares a properties pane with their conventions.
 */
export const AGENT_MEMORY_CONSOLIDATED_THROUGH = "consolidated-through";
