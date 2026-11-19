import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";

const AGENT_MODE_PREFIX = "copilot-agent-";

export interface CustomAgentMode {
  slug: string;
  auto: boolean;
}

// A slug is one folder name and never holds "/", so the "/" before the mode closes the slug off and one agent's ids never equal another's.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/937
export function customAgentModeId({ slug, auto }: CustomAgentMode): string {
  return `${AGENT_MODE_PREFIX}${slug}/${auto ? "auto" : "default"}`;
}

export function readCustomAgentModeId(modeId: string): CustomAgentMode | null {
  if (!modeId.startsWith(AGENT_MODE_PREFIX)) return null;
  const rest = modeId.slice(AGENT_MODE_PREFIX.length);
  const cut = rest.lastIndexOf("/");
  const mode = rest.slice(cut + 1);
  if (cut < 0 || (mode !== "default" && mode !== "auto")) return null;
  return { slug: rest.slice(0, cut), auto: mode === "auto" };
}

export function opencodeAgentsFilePath(app: App): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return path.join(
    copilotAppDataDir(os.homedir()),
    "vaults",
    getVaultId(app),
    "opencode-agents.json"
  );
}

// OpenCode watches the file through its folder and never watches a folder that is missing when it starts, so later writes would never load.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/937
export async function createAgentsFolder(file: string): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  const path = requireNodeModule<typeof import("node:path")>("path");
  await fs.mkdir(path.dirname(file), { recursive: true });
}

// OpenCode reloads the file as soon as it changes, so a reader must never see it half written.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/937
export async function writeAgentsFile(file: string, content: string): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  await createAgentsFolder(file);
  const staged = `${file}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(staged, content);
  await fs.rename(staged, file);
}
