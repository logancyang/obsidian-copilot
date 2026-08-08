/**
 * Shared scope identity for Agent Mode sessions and persisted chats.
 *
 * A session/chat is either bound to a real project (its `projectId`) or to the
 * implicit global workspace. The sentinel below is the authoritative key for
 * that global bucket so every layer (session manager, persistence, history)
 * agrees on one value instead of juggling `undefined` vs empty string.
 */
/**
 * DESIGN NOTE — `__global__` sentinel vs a hand-edited project id (deferred).
 *
 * (a) Trigger: a project's `AGENTS.md`/`project.md` frontmatter `id` is manually
 *     edited (or corrupted by a sync conflict) to the literal string
 *     `"__global__"`. Normal project ids are UUIDs minted by AddProjectModal, so
 *     this is only reachable by hand-editing frontmatter, not through the UI.
 * (b) Impact: that project collides with the global sentinel and is treated as
 *     global — its session cwd falls back to the vault root, `enterProject`
 *     validation is skipped, and saved chats write no `projectId` frontmatter.
 * (c) Why it's not fixed here: the correct guard is a reserved-id check at
 *     project creation/parse time (`createProject` / `parseProjectConfigFile`).
 *     Enforcing it from this module would force `projects/` to reverse-import a
 *     `session/` sentinel — a layering inversion not worth paying. Reserved-id
 *     validation belongs in the project domain, where this guard should live.
 */
export const GLOBAL_SCOPE = "__global__" as const;

/** A real project id, or {@link GLOBAL_SCOPE} for the global workspace. */
export type ProjectScopeId = string;
