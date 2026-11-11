import type { BackendId } from "@/agentMode/session/types";
import { composeDenyList } from "@/agentMode/skills/denyListComposer";
import type { Skill } from "@/agentMode/skills/types";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

const SKILLS_CONFIG_PATH = [".agent", "skills.json"] as const;
const SHARED_SKILLS_DIR = ".agents/skills";

function skillsConfigText(patterns: readonly string[]): string {
  return `${JSON.stringify({ entries: [{ path: SHARED_SKILLS_DIR, exclude: patterns }] }, null, 2)}\n`;
}

function wholeNamePattern(name: string): string {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

function writtenByCopilot(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { entries?: Array<{ exclude?: unknown }> };
    const patterns = parsed.entries?.[0]?.exclude;
    return (
      Array.isArray(patterns) &&
      patterns.every((pattern) => typeof pattern === "string") &&
      text === skillsConfigText(patterns)
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
  const next = names.length > 0 ? skillsConfigText(names.map(wholeNamePattern)) : null;
  if (next === current) return;
  if (next === null) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
}
