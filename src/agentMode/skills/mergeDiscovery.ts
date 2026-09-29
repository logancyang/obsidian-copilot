import type { ProjectSkillCandidate } from "./discoverProjectSkills";
import type { BackendId, Skill } from "./types";

export function mergeDiscovery(
  canonicalSkills: ReadonlyArray<Skill>,
  projectCandidates: ReadonlyArray<ProjectSkillCandidate>
): Skill[] {
  const out: Skill[] = canonicalSkills.map((s) => ({ ...s }));
  const canonicalNames = new Set(canonicalSkills.map((s) => s.name));

  const byName = new Map<string, ProjectSkillCandidate[]>();
  for (const candidate of projectCandidates) {
    if (canonicalNames.has(candidate.name)) continue;
    const list = byName.get(candidate.name);
    if (list === undefined) {
      byName.set(candidate.name, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  for (const [name, candidates] of byName) {
    const byHash = new Map<string, ProjectSkillCandidate[]>();
    for (const candidate of candidates) {
      const list = byHash.get(candidate.contentHash);
      if (list === undefined) {
        byHash.set(candidate.contentHash, [candidate]);
      } else {
        list.push(candidate);
      }
    }

    const partitions = Array.from(byHash.values());
    const needsSuffix = partitions.length > 1;

    for (const partition of partitions) {
      partition.sort((a, b) => a.agent.localeCompare(b.agent));
      const representative = partition[0];
      const agents = partition.map((c) => c.agent);

      const fm = representative.parsed.frontmatter;
      const skill: Skill = {
        name,
        description: fm.description,
        filePath: representative.filePath,
        dirPath: representative.dirPath,
        body: representative.parsed.body,
        license: fm.license,
        compatibility: fm.compatibility,
        allowedTools: fm.allowedTools,
        model: fm.model,
        disableModelInvocation: fm.disableModelInvocation,
        userInvocable: fm.userInvocable,
        enabledAgents: agents,
        location: { kind: "project", agentDirs: agents },
        contentHash: representative.contentHash,
      };

      if (needsSuffix) {
        skill.displayNameSuffix = ` (${representative.agent})`;
      }

      out.push(skill);
    }
  }

  return sortSkills(out);
}

export function compareSkills(a: Skill, b: Skill): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const bySuffix = (a.displayNameSuffix ?? "").localeCompare(b.displayNameSuffix ?? "");
  if (bySuffix !== 0) return bySuffix;
  return a.dirPath.localeCompare(b.dirPath);
}

function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort(compareSkills);
}

export function formatSkillDisplayName(skill: Skill): string {
  return skill.displayNameSuffix !== undefined
    ? `${skill.name}${skill.displayNameSuffix}`
    : skill.name;
}

export type { ProjectSkillCandidate, BackendId };
