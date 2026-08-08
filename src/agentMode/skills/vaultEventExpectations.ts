import { normalizeAbsPath } from "@/utils/pathUtils";
import type { BackendId, Skill } from "./types";

/**
 * A predicate describing a vault-relative path that the {@link SkillManager}
 * just touched. While an expectation is live, watcher events for that path
 * are dropped: they were caused by our own write, not by the user.
 *
 * Each expectation is cleared as soon as the desired on-disk state for the
 * path is observed (predicate satisfied), or as a backstop when the
 * SkillManager's safety timer fires. Predicates therefore replace the
 * previous time-based heuristic — slow watchers extend the wait
 * automatically, fast watchers lift it immediately.
 *
 * - `exists` / `missing`: exact-path predicates against `vault.adapter.exists`.
 * - `subtree-exists` / `subtree-missing`: prefix match. Used for recursive
 *   create/delete where many nested events fire and only the root state is
 *   meaningful.
 * - `modified`: consumed by any matching event without an FS check. Used
 *   for in-place rewrites (e.g. SKILL.md frontmatter patch) where the file
 *   stays at the same path.
 */
export type Expectation =
  | { kind: "exists"; vaultRelPath: string }
  | { kind: "missing"; vaultRelPath: string }
  | { kind: "subtree-exists"; vaultRelPath: string }
  | { kind: "subtree-missing"; vaultRelPath: string }
  | { kind: "modified"; vaultRelPath: string };

/**
 * True when this vault event path is described by the expectation.
 * `exp.vaultRelPath` is expected to already be normalized (slash-only, no
 * leading/trailing slashes) — see {@link absToVaultRel}.
 */
export function matchExpectation(exp: Expectation, eventPath: string): boolean {
  const path = normalizeRel(eventPath);
  if (exp.kind === "subtree-exists" || exp.kind === "subtree-missing") {
    return path === exp.vaultRelPath || path.startsWith(`${exp.vaultRelPath}/`);
  }
  return path === exp.vaultRelPath;
}

/**
 * Strip a vault-root prefix from an absolute path. Returns `null` when
 * `absPath` is not under `vaultRootAbs` — the caller should skip the
 * expectation rather than match a foreign event.
 */
export function absToVaultRel(absPath: string, vaultRootAbs: string): string | null {
  const abs = normalizeAbsPath(absPath);
  const root = normalizeAbsPath(vaultRootAbs);
  if (abs === root) return "";
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
  return null;
}

function normalizeRel(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Expectations after `toggleAgent`: a frontmatter rewrite of the canonical
 * SKILL.md and a symlink that should now exist (enable) or be gone (disable).
 */
export function buildToggleExpectations(
  skill: Skill,
  enabled: boolean,
  agentDirAbs: string,
  vaultRootAbs: string
): Expectation[] {
  const exps: Expectation[] = [];
  pushIfRel(exps, skill.filePath, vaultRootAbs, (path) => ({
    kind: "modified",
    vaultRelPath: path,
  }));
  pushIfRel(exps, `${agentDirAbs}/${skill.name}`, vaultRootAbs, (path) => ({
    kind: enabled ? "exists" : "missing",
    vaultRelPath: path,
  }));
  return exps;
}

/**
 * Expectations after `deleteSkill`: the canonical dir is gone (subtree) and
 * each agent symlink that pointed at it is gone.
 */
export function buildDeleteExpectations(
  skill: Skill,
  agentDirsAbs: Readonly<Record<BackendId, string>>,
  vaultRootAbs: string
): Expectation[] {
  const exps: Expectation[] = [];
  pushIfRel(exps, skill.dirPath, vaultRootAbs, (path) => ({
    kind: "subtree-missing",
    vaultRelPath: path,
  }));
  for (const agentDir of Object.values(agentDirsAbs)) {
    pushIfRel(exps, `${agentDir}/${skill.name}`, vaultRootAbs, (path) => ({
      kind: "missing",
      vaultRelPath: path,
    }));
  }
  return exps;
}

/** Expectation after `updateProperties`: SKILL.md was rewritten in place. */
export function buildUpdatePropertiesExpectations(
  skill: Skill,
  vaultRootAbs: string
): Expectation[] {
  const exps: Expectation[] = [];
  pushIfRel(exps, skill.filePath, vaultRootAbs, (path) => ({
    kind: "modified",
    vaultRelPath: path,
  }));
  return exps;
}

/**
 * Expectations after `renameSkill`: the old canonical dir disappears, the
 * new one appears, and per-agent links flip from the old basename to the
 * new one.
 */
export function buildRenameExpectations(
  oldSkill: Skill,
  newName: string,
  canonicalAbsRoot: string,
  agentDirsAbs: Readonly<Record<BackendId, string>>,
  vaultRootAbs: string
): Expectation[] {
  const exps: Expectation[] = [];
  const root = normalizeAbsPath(canonicalAbsRoot);
  pushIfRel(exps, oldSkill.dirPath, vaultRootAbs, (path) => ({
    kind: "subtree-missing",
    vaultRelPath: path,
  }));
  pushIfRel(exps, `${root}/${newName}`, vaultRootAbs, (path) => ({
    kind: "subtree-exists",
    vaultRelPath: path,
  }));
  for (const agentDir of Object.values(agentDirsAbs)) {
    pushIfRel(exps, `${agentDir}/${oldSkill.name}`, vaultRootAbs, (path) => ({
      kind: "missing",
      vaultRelPath: path,
    }));
    pushIfRel(exps, `${agentDir}/${newName}`, vaultRootAbs, (path) => ({
      kind: "exists",
      vaultRelPath: path,
    }));
  }
  return exps;
}

/**
 * Expectations after a `reconcile` pass: every created link should now
 * exist and every removed orphan should now be gone. Errors do not get an
 * expectation — the next refresh will retry them.
 */
export function buildReconcileExpectations(
  report: { created: readonly string[]; removedOrphans: readonly string[] },
  vaultRootAbs: string
): Expectation[] {
  const exps: Expectation[] = [];
  for (const path of report.created) {
    pushIfRel(exps, path, vaultRootAbs, (rel) => ({ kind: "exists", vaultRelPath: rel }));
  }
  for (const path of report.removedOrphans) {
    pushIfRel(exps, path, vaultRootAbs, (rel) => ({ kind: "missing", vaultRelPath: rel }));
  }
  return exps;
}

/** Helper: build an expectation only when the absolute path lies inside the vault. */
function pushIfRel(
  exps: Expectation[],
  absPath: string,
  vaultRootAbs: string,
  build: (vaultRelPath: string) => Expectation
): void {
  const rel = absToVaultRel(absPath, vaultRootAbs);
  if (rel === null) return;
  exps.push(build(rel));
}
