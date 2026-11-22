import type { BackendId, Skill } from "./types";

export function composeDenyList(
  allSkills: Skill[],
  backend: BackendId,
  crossDiscoveredAgents: ReadonlyArray<BackendId>
): string[] {
  if (crossDiscoveredAgents.length === 0) return [];

  const deny = new Set<string>();
  for (const skill of allSkills) {
    if (skill.enabledAgents.includes(backend)) continue;
    // Failed cleanup can leave disabled built-ins in cross-discovered folders. https://github.com/logancyang/obsidian-copilot/issues/3022
    if (skill.builtin || skill.enabledAgents.some((a) => crossDiscoveredAgents.includes(a))) {
      deny.add(skill.name);
    }
  }
  return Array.from(deny).sort();
}
