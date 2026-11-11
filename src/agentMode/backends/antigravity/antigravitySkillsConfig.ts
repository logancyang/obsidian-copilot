import type { BackendId } from "@/agentMode/session/types";
import { composeDenyList } from "@/agentMode/skills/denyListComposer";
import type { Skill } from "@/agentMode/skills/types";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

const SKILLS_CONFIG_PATH = [".agent", "skills.json"] as const;

function skillsConfigText(names: readonly string[]): string {
  return `${JSON.stringify({ exclude: names }, null, 2)}\n`;
}

function writtenByCopilot(text: string): boolean {
  try {
    const names = (JSON.parse(text) as { exclude?: unknown }).exclude;
    return (
      Array.isArray(names) &&
      names.every((name) => typeof name === "string") &&
      text === skillsConfigText(names)
    );
  } catch {
    return false;
  }
}

export async function syncAntigravitySkillsConfig(
  vaultBasePath: string,
  managedSkills: readonly Skill[],
  crossDiscoveredAgents: ReadonlyArray<BackendId>
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  const path = requireNodeModule<typeof import("node:path")>("path");
  const file = path.join(vaultBasePath, ...SKILLS_CONFIG_PATH);
  const current = await fs
    .readFile(file, "utf8")
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : Promise.reject(error)
    );
  if (current !== null && !writtenByCopilot(current)) {
    logWarn(
      `[AgentMode] ${file} was not written by Copilot, so Copilot leaves it as is; skills switched on for Codex stay visible to Antigravity.`
    );
    return;
  }
  const names = composeDenyList([...managedSkills], "antigravity", crossDiscoveredAgents);
  const next = names.length > 0 ? skillsConfigText(names) : null;
  if (next === current) return;
  if (next === null) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
}
