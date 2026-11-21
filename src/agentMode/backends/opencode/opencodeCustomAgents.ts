import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";

const AGENT_MODE_PREFIX = "copilot-teammate-";

export interface CustomAgentMode {
  slug: string;
  variant?: string;
  auto: boolean;
}

// A slug is one folder name and never holds "/", so the "/" before the mode closes the slug off and one agent's ids never equal another's.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/937
// Each prompt variant of an agent gets its own ids so one variant never overwrites another; an agent with no variant keeps the ids chats saved before then still run on.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/991
export function customAgentModeId({ slug, variant, auto }: CustomAgentMode): string {
  return `${AGENT_MODE_PREFIX}${slug}/${variant ? `${variant}/` : ""}${auto ? "auto" : "default"}`;
}

export function readCustomAgentModeId(modeId: string): CustomAgentMode | null {
  if (!modeId.startsWith(AGENT_MODE_PREFIX)) return null;
  const [slug, ...rest] = modeId.slice(AGENT_MODE_PREFIX.length).split("/");
  const mode = rest.pop();
  if (!slug || rest.length > 1 || (mode !== "default" && mode !== "auto")) return null;
  return { slug, variant: rest[0], auto: mode === "auto" };
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
// A staged copy left by a failed write would keep agents' prompts beside the file after they are deleted.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/991
export async function writeAgentsFile(file: string, content: string): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  await createAgentsFolder(file);
  const staged = `${file}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(staged, content);
    await fs.rename(staged, file);
  } catch (error) {
    await fs.rm(staged, { force: true });
    throw error;
  }
}

interface AgentsFile {
  entries: Record<string, unknown>;
  written: Promise<void>;
}

// The running OpenCode adds the entries its chats run from and deleting an agent removes them, so both share one record of each file, which also keeps their writes in order.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/991
const agentsFiles = new Map<string, AgentsFile>();

function agentsFile(file: string): AgentsFile {
  let known = agentsFiles.get(file);
  if (!known) {
    known = { entries: {}, written: Promise.resolve() };
    agentsFiles.set(file, known);
  }
  return known;
}

function queueWrite(known: AgentsFile, write: () => Promise<void>): Promise<void> {
  known.written = known.written.catch(() => undefined).then(write);
  return known.written;
}

// Each OpenCode start begins with no entries, so its first write drops those of agents that earlier runs wrote and that may no longer exist.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/991
export function startAgentEntries(file: string): void {
  agentsFile(file).entries = {};
}

export function putAgentEntries(file: string, entries: Record<string, unknown>): Promise<void> {
  const known = agentsFile(file);
  Object.assign(known.entries, entries);
  return queueWrite(known, () => writeAgentsFile(file, JSON.stringify({ agents: known.entries })));
}

export function removeAgentEntries(file: string, slug: string): Promise<void> {
  const known = agentsFile(file);
  const isAgents = (id: string) => readCustomAgentModeId(id)?.slug === slug;
  for (const id of Object.keys(known.entries)) {
    if (isAgents(id)) delete known.entries[id];
  }
  return queueWrite(known, async () => {
    const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
    // No file means OpenCode never ran an agent in this vault, so there is nothing to remove.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/991
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (content === null) return;
    const { agents } = JSON.parse(content) as { agents: Record<string, unknown> };
    const kept = Object.entries(agents).filter(([id]) => !isAgents(id));
    await writeAgentsFile(file, JSON.stringify({ agents: Object.fromEntries(kept) }));
  });
}
