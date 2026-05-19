import type { BackendId, Skill } from "./types";

/**
 * Compose the per-backend skill deny list for cross-discovered managed
 * skills. See spec §Filtering enabled skills per backend.
 *
 * Cross-discovery model: a backend may walk skill directories owned by
 * other backends in addition to its own. Today only OpenCode does this
 * (`.claude/skills/` and `.agents/skills/` in addition to
 * `.opencode/skills/`). Each backend declares its cross-discovery surface
 * on its `BackendDescriptor.crossDiscoveredAgents` — this function only
 * consumes that data, it does not own it.
 *
 * The deny list is `cross_discovered − enabled_for_<backend>`: skill names
 * that the backend would otherwise see via cross-discovery but are not
 * enabled for it. Pure leaf helper — no Obsidian / fs / singleton / backend
 * imports — so callers can drive it with plain `Skill[]` arrays from tests.
 *
 * @param allSkills              All managed skills discovered in the canonical store.
 * @param backend                The backend the caller is composing a config for.
 * @param crossDiscoveredAgents  Other backends whose skills `backend` also
 *                               loads at spawn time (i.e.
 *                               `BackendDescriptor.crossDiscoveredAgents`).
 * @returns Sorted (lexicographic) array of skill names to deny, with no
 *          duplicates. Empty array when no skills need denying. The sort
 *          is for log-line stability — the OpenCode config consumer is a
 *          `Record<string, string>` so it doesn't care, but a stable
 *          ordering makes the `joined` log message diff-friendly when
 *          comparing two sessions.
 */
export function composeDenyList(
  allSkills: Skill[],
  backend: BackendId,
  crossDiscoveredAgents: ReadonlyArray<BackendId>
): string[] {
  if (crossDiscoveredAgents.length === 0) return [];

  const deny = new Set<string>();
  for (const skill of allSkills) {
    if (skill.enabledAgents.includes(backend)) continue;
    if (skill.enabledAgents.some((a) => crossDiscoveredAgents.includes(a))) {
      deny.add(skill.name);
    }
  }
  return Array.from(deny).sort();
}
