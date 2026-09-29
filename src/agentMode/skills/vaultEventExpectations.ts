import { normalizeAbsPath } from "@/utils/pathUtils";
import type { BackendId, Skill } from "./types";

export type Expectation =
  | { kind: "exists"; vaultRelPath: string }
  | { kind: "missing"; vaultRelPath: string }
  | { kind: "subtree-exists"; vaultRelPath: string }
  | { kind: "subtree-missing"; vaultRelPath: string }
  | { kind: "modified"; vaultRelPath: string };

export function matchExpectation(exp: Expectation, eventPath: string): boolean {
  const path = normalizeRel(eventPath);
  if (exp.kind === "subtree-exists" || exp.kind === "subtree-missing") {
    return path === exp.vaultRelPath || path.startsWith(`${exp.vaultRelPath}/`);
  }
  return path === exp.vaultRelPath;
}

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
