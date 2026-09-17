import { buildAgentMemorySkeleton, parseAgentFile, serializeAgentFile } from "@/agents/agentFile";
import {
  deriveUniqueAgentSlug,
  getAgentFilePath,
  getAgentFolderPath,
  getAgentMemoryPath,
} from "@/agents/agentPaths";
import { AGENT_FILE_NAME } from "@/agents/constants";
import type { AgentDraft, AgentRecord, CustomAgent } from "@/agents/types";
import { logInfo, logWarn } from "@/logger";
import { deriveAgentsFolder } from "@/settings/copilotFolder";
import { getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, TFile, TFolder, Vault } from "obsidian";

/**
 * Owns the `copilot/agents/<slug>/` tree: listing agents, creating the two
 * files a new one starts with, writing edits back, and trashing an agent whole.
 *
 * It is the only writer of `agent.md`. That file is the user's own note — they
 * may open and edit it in Obsidian — so nothing else in Copilot rewrites it,
 * and this class rewrites it only when the Agents editor saves.
 *
 * Its boundary stops at the files. It holds no cache and no selection state:
 * callers read the folder when they need it, so a hand edit or a sync is
 * visible on the next read rather than behind an invalidation step.
 */
export class AgentFileManager {
  private readonly vault: Vault;

  constructor(private readonly app: App) {
    this.vault = app.vault;
  }

  /**
   * Resolve the agents root for one operation.
   *
   * Read once per public method and then passed down, per the design note in
   * `copilotFolder.ts`: the Copilot root activates the instant it is saved, so
   * a method that resolved twice could read one tree and write another.
   */
  private agentsFolder(): string {
    return deriveAgentsFolder(getSettings());
  }

  /**
   * Every agent currently on disk, sorted by display name.
   *
   * A sub-folder without an `agent.md` is skipped rather than reported: the
   * user may be part-way through creating one by hand, and an unreadable one
   * is logged so a permissions problem is diagnosable from the Copilot log.
   */
  public async listAgents(): Promise<AgentRecord[]> {
    const agentsFolder = this.agentsFolder();
    const folder = this.vault.getAbstractFileByPath(agentsFolder);
    if (!(folder instanceof TFolder)) return [];

    const records: AgentRecord[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      const record = await this.readRecord(agentsFolder, child.name);
      if (record) records.push(record);
    }
    return records.sort((a, b) =>
      a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: "base" })
    );
  }

  /** One agent by slug, or null when its folder or `agent.md` is gone. */
  public async readAgent(slug: string): Promise<AgentRecord | null> {
    return this.readRecord(this.agentsFolder(), slug);
  }

  /**
   * An agent's `MEMORY.md` with the time it was last written, or null when the
   * file is absent (a hand-deleted one, or an agent whose folder predates it).
   *
   * The timestamp travels with the text because a conversation is told how old
   * the agent's recollection is, not just what it says — see the
   * `<agent_memory updated="…">` block in `designdocs/CUSTOM_AGENTS.md` §4.
   *
   * @param slug - Identity of the agent whose memory is read.
   */
  public async readMemoryDocument(
    slug: string
  ): Promise<{ text: string; modifiedAtMs: number } | null> {
    const file = this.vault.getAbstractFileByPath(getAgentMemoryPath(this.agentsFolder(), slug));
    if (!(file instanceof TFile)) return null;
    return { text: await this.vault.read(file), modifiedAtMs: file.stat.mtime };
  }

  /**
   * Create an agent: its folder, its `agent.md`, and an empty `MEMORY.md`
   * carrying the fixed headings.
   *
   * The slug is derived from the name here and never again — renaming the agent
   * afterwards leaves the folder where it is, which is what keeps saved chats
   * and `@` mentions resolving.
   *
   * @param draft - Editor field values for the new agent.
   */
  public async createAgent(draft: AgentDraft): Promise<AgentRecord> {
    const name = draft.name.trim();
    if (!name) throw new Error("Give the agent a name.");

    const agentsFolder = this.agentsFolder();
    await ensureFolderExists(this.vault, agentsFolder);
    const slug = deriveUniqueAgentSlug(name, await this.listSlugs(agentsFolder));
    const folderPath = getAgentFolderPath(agentsFolder, slug);
    const filePath = getAgentFilePath(agentsFolder, slug);
    const memoryPath = getAgentMemoryPath(agentsFolder, slug);

    const agent: CustomAgent = { ...draft, name, slug, created: new Date().toISOString() };
    await ensureFolderExists(this.vault, folderPath);
    await this.vault.create(filePath, serializeAgentFile(agent));
    await this.vault.create(memoryPath, buildAgentMemorySkeleton(name));

    logInfo(`[Agents] Created agent "${name}" at ${folderPath}`);
    return { agent, folderPath, filePath, memoryPath, memoryBytes: 0 };
  }

  /**
   * Write edited fields back to an existing agent's `agent.md`.
   *
   * The folder is located by slug, not by the new name, so a rename is a
   * one-file write and never a move.
   *
   * @param slug - Identity of the agent being edited.
   * @param draft - Editor field values to persist.
   */
  public async updateAgent(slug: string, draft: AgentDraft): Promise<AgentRecord> {
    const name = draft.name.trim();
    if (!name) throw new Error("Give the agent a name.");

    const agentsFolder = this.agentsFolder();
    const existing = await this.readRecord(agentsFolder, slug);
    if (!existing) throw new Error(`Agent not found: ${slug}`);

    const agent: CustomAgent = { ...draft, name, slug, created: existing.agent.created };
    const file = this.vault.getAbstractFileByPath(existing.filePath);
    if (!(file instanceof TFile)) throw new Error(`Agent file not found: ${existing.filePath}`);
    await this.vault.modify(file, serializeAgentFile(agent));

    logInfo(`[Agents] Updated agent "${name}" at ${existing.filePath}`);
    return { ...existing, agent };
  }

  /**
   * Move an agent's whole folder to trash, memory file included.
   *
   * Deleting an agent that is already gone is not an error: the list the user
   * clicked from can be a moment stale (an external sync, a second window), and
   * the outcome they asked for already holds.
   *
   * @param slug - Identity of the agent to delete.
   */
  public async deleteAgent(slug: string): Promise<void> {
    const folderPath = getAgentFolderPath(this.agentsFolder(), slug);
    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      logWarn(`[Agents] deleteAgent: no folder at ${folderPath}`);
      return;
    }
    await trashFile(this.app, folder);
    logInfo(`[Agents] Deleted agent folder ${folderPath}`);
  }

  /**
   * Reset an agent's `MEMORY.md` to the empty skeleton, recreating the file if
   * the user deleted it, so "Clear memory" always leaves a file the agent can
   * append to next time.
   *
   * @param slug - Identity of the agent whose memory is cleared.
   */
  public async clearMemory(slug: string): Promise<void> {
    const agentsFolder = this.agentsFolder();
    const record = await this.readRecord(agentsFolder, slug);
    if (!record) throw new Error(`Agent not found: ${slug}`);

    const skeleton = buildAgentMemorySkeleton(record.agent.name);
    const file = this.vault.getAbstractFileByPath(record.memoryPath);
    if (file instanceof TFile) {
      await this.vault.modify(file, skeleton);
    } else {
      await this.vault.create(record.memoryPath, skeleton);
    }
    logInfo(`[Agents] Cleared memory at ${record.memoryPath}`);
  }

  /** Slugs of the folders directly under the agents root, agent files or not. */
  private async listSlugs(agentsFolder: string): Promise<string[]> {
    const folder = this.vault.getAbstractFileByPath(agentsFolder);
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((child) => child instanceof TFolder).map((child) => child.name);
  }

  private async readRecord(agentsFolder: string, slug: string): Promise<AgentRecord | null> {
    const filePath = getAgentFilePath(agentsFolder, slug);
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;

    let raw: string;
    try {
      raw = await this.vault.read(file);
    } catch (error) {
      logWarn(`[Agents] Could not read ${AGENT_FILE_NAME} for "${slug}"`, error);
      return null;
    }

    const memoryPath = getAgentMemoryPath(agentsFolder, slug);
    const memoryFile = this.vault.getAbstractFileByPath(memoryPath);
    return {
      agent: parseAgentFile(slug, raw),
      folderPath: getAgentFolderPath(agentsFolder, slug),
      filePath,
      memoryPath,
      memoryBytes: memoryFile instanceof TFile ? memoryFile.stat.size : 0,
    };
  }
}
