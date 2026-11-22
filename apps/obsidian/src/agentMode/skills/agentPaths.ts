export { DEFAULT_SKILLS_FOLDER } from "@/constants";

export function agentSkillsDirAbs(vaultRootAbs: string, projectRelDir: string): string {
  const left = vaultRootAbs.replace(/[/\\]+$/, "");
  const right = projectRelDir.replace(/^[/\\]+/, "");
  return `${left}/${right}`;
}
