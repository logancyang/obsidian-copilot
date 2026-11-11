import type { ReadOnlySkill } from "@/agentMode/skills/types";

export function makeReadOnlySkill(
  overrides: Partial<ReadOnlySkill> & { name: string }
): ReadOnlySkill {
  const { name } = overrides;
  const folder = overrides.folders?.[0] ?? "/home/me/.claude/skills";
  return {
    description: `desc for ${name}`,
    body: `body for ${name}`,
    filePath: `${folder}/${name}/SKILL.md`,
    dirPath: `${folder}/${name}`,
    folders: [folder],
    agents: ["claude"],
    scope: "computer",
    ...overrides,
  };
}
