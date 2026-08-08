import type { ProjectSkillCandidate } from "./discoverProjectSkills";
import type { BackendId, Skill } from "./types";

/**
 * Build the final `Skill[]` shown in the Skills tab from the result of
 * `discoverManagedSkills` (canonical pass) and `discoverProjectSkills`
 * (per-agent walks).
 *
 * Merge rules:
 *
 *   1. Canonical row wins the name. If a name collides between canonical
 *      and any project candidate, the project candidates with that name are
 *      dropped from the merged result so the tab shows one row per name.
 *      NOTE: reconciliation does NOT remove the dropped real directory —
 *      it only ever touches symlinks, never user-owned real dirs (see
 *      `reconcile.ts` phase 2). The agent-folder copy therefore stays on
 *      disk and the agent keeps loading it; the collision is hidden from
 *      the tab rather than resolved. Renaming the canonical skill is the
 *      way out.
 *   2. Same name + same `contentHash` across multiple agent dirs → one
 *      project-mirrored row with `enabledAgents = [each agent]`. The
 *      chosen representative copy is the alphabetically-first agent dir
 *      (deterministic — see the SORT_ORDER comment below).
 *   3. Same name + different `contentHash` (across agents) → kept as
 *      separate rows. Each row's UI label gets a `(agent)` suffix via
 *      `displayNameSuffix` to disambiguate; the on-disk frontmatter
 *      `name` is untouched.
 *
 * The sort key is the BackendId (`claude` < `codex` < `opencode`) —
 * the alphabetical comparison happens via `localeCompare`, which is
 * stable and Unicode-aware. Tests rely on this determinism so two test
 * runs produce the same representative agent across mirrored skills.
 */
export function mergeDiscovery(
  canonicalSkills: ReadonlyArray<Skill>,
  projectCandidates: ReadonlyArray<ProjectSkillCandidate>
): Skill[] {
  const out: Skill[] = canonicalSkills.map((s) => ({ ...s }));
  const canonicalNames = new Set(canonicalSkills.map((s) => s.name));

  // Group surviving project candidates by name.
  const byName = new Map<string, ProjectSkillCandidate[]>();
  for (const candidate of projectCandidates) {
    // Rule 1: canonical wins the name; drop the project candidate.
    if (canonicalNames.has(candidate.name)) continue;
    const list = byName.get(candidate.name);
    if (list === undefined) {
      byName.set(candidate.name, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  // For each name, partition by contentHash and emit either:
  //   - one row per partition (mirrored across the agents with matching hash); or
  //   - one row per (hash) when different content yields multiple partitions
  //     (and stamp `displayNameSuffix` so the rows are distinguishable in the UI).
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
      // Sort the partition by agent id (alphabetically-first wins as the
      // representative; this is the determinism contract).
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
        // Disambiguation suffix — UI concern only. Use the
        // alphabetically-first agent in the partition.
        skill.displayNameSuffix = ` (${representative.agent})`;
      }

      out.push(skill);
    }
  }

  // Keep the published order stable so React keys / row identity don't
  // shuffle between renders. Canonical rows already sort by dirPath via
  // discovery; we append project rows sorted by (name, representative
  // agent) so the order is predictable.
  return sortSkills(out);
}

/**
 * Deterministic skill ordering comparator. Sorts by name, then by the
 * project disambiguator suffix (so `foo (claude)` precedes `foo (codex)`),
 * then by `dirPath` as a final tiebreaker for full determinism.
 *
 * Exported and shared so the full-discovery publish path (here) and the
 * incremental-update publish path (`SkillManager`) order the list
 * identically — otherwise an incremental edit after a discovery pass would
 * reshuffle every row (React keys are `dirPath`), re-mounting each row.
 */
export function compareSkills(a: Skill, b: Skill): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const bySuffix = (a.displayNameSuffix ?? "").localeCompare(b.displayNameSuffix ?? "");
  if (bySuffix !== 0) return bySuffix;
  return a.dirPath.localeCompare(b.dirPath);
}

/** Sort a skill list with the shared {@link compareSkills} ordering. */
function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort(compareSkills);
}

/**
 * Format the user-facing name for a skill row. Concatenates the on-disk
 * name with the optional `displayNameSuffix`. Pure helper used by the
 * row renderer so the suffix-stamping logic lives in one place.
 */
export function formatSkillDisplayName(skill: Skill): string {
  return skill.displayNameSuffix !== undefined
    ? `${skill.name}${skill.displayNameSuffix}`
    : skill.name;
}

/**
 * Type re-export for callers that want the discovered candidate shape
 * without reaching into the discoverProjectSkills module directly.
 */
export type { ProjectSkillCandidate, BackendId };
