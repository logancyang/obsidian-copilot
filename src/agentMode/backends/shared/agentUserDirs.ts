import type { BackendId } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";

export function agentChildEnv(settings: CopilotSettings, backendId: BackendId): NodeJS.ProcessEnv {
  const backends = settings.agentMode?.backends as
    | Partial<Record<BackendId, { envOverrides?: Record<string, string> }>>
    | undefined;
  return { ...process.env, ...(backends?.[backendId]?.envOverrides ?? {}) };
}

// Agents resolve their home folder from the HOME they run with, which env overrides can change;
// Windows agents read the profile folder instead.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/868
export function agentHomeDir(env: NodeJS.ProcessEnv): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return (process.platform !== "win32" && env.HOME) || os.homedir();
}

export function agentUserPath(env: NodeJS.ProcessEnv, ...segments: string[]): string {
  const path = requireNodeModule<typeof import("node:path")>("path");
  return path.join(agentHomeDir(env), ...segments);
}
