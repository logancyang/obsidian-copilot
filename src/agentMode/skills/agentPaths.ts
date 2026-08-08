export { DEFAULT_SKILLS_FOLDER } from "@/constants";

/**
 * POSIX-join an absolute vault root with a project-relative subdirectory
 * (e.g. `.claude/skills`). Trailing/leading slashes on the inputs are
 * normalized out. Callers must pass an absolute root; this helper does no
 * resolution of its own.
 */
export function agentSkillsDirAbs(vaultRootAbs: string, projectRelDir: string): string {
  const left = vaultRootAbs.replace(/[/\\]+$/, "");
  const right = projectRelDir.replace(/^[/\\]+/, "");
  return `${left}/${right}`;
}
