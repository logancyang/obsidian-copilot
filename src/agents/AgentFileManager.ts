import { buildAgentMemorySkeleton, parseAgentFile, serializeAgentFile } from "@/agents/agentFile";
import {
  appendToDailyNote,
  hashMemoryContent,
  parseAgentMemoryFile,
  serializeAgentMemoryFile,
} from "@/agents/agentMemoryFile";
import {
  deriveUniqueAgentSlug,
  getAgentDailyNotePath,
  getAgentFilePath,
  getAgentFolderPath,
  getAgentMemoryFolderPath,
  getAgentMemoryPath,
  parseAgentDailyNoteDate,
} from "@/agents/agentPaths";
import type { AgentDailyNoteInput } from "@/agents/agentMemory";
import { AGENT_FILE_NAME } from "@/agents/constants";
import type { AgentDraft, AgentRecord, CustomAgent } from "@/agents/types";
import { logInfo, logWarn } from "@/logger";
import { deriveAgentsFolder } from "@/settings/copilotFolder";
import { getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, TFile, TFolder, Vault } from "obsidian";

/** An agent's `MEMORY.md` as the session and the consolidation pass read it. */
export interface AgentMemoryRead {
  /** Full file contents, frontmatter included. */
  text: string;
  /** The part below the frontmatter — what a conversation is given. */
  body: string;
  /** Last daily note folded in, or null when the file has never been consolidated. */
  consolidatedThrough: string | null;
  /** Modification time, which dates the `<agent_memory updated="…">` attribute. */
  modifiedAtMs: number;
  /** Identity of `text`, re-checked before a consolidation overwrites the file. */
  hash: string;
}

/** One day of an agent's daily notes, with where it lives. */
export interface DailyNoteRead {
  /** Day the note records, as `YYYY-MM-DD`. */
  date: string;
  /** Vault-relative path, so a trust line can offer the note. */
  path: string;
  text: string;
  modifiedAtMs: number;
}

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

  /** Vault-relative `memory/` folder of one agent, resolved against today's root. */
  public getMemoryFolderPath(slug: string): string {
    return getAgentMemoryFolderPath(this.agentsFolder(), slug);
  }

  /**
   * Vault-relative path of one agent's note for `date`, whether or not it
   * exists yet — what the persona block names as the place to append to.
   *
   * @param date - Day the note records, as `YYYY-MM-DD`.
   */
  public getDailyNotePath(slug: string, date: string): string {
    return getAgentDailyNotePath(this.agentsFolder(), slug, date);
  }

  /** One agent by slug, or null when its folder or `agent.md` is gone. */
  public async readAgent(slug: string): Promise<AgentRecord | null> {
    return this.readRecord(this.agentsFolder(), slug);
  }

  /**
   * An agent's `MEMORY.md`, split into the body a conversation is given and the
   * consolidation bookkeeping above it, or null when the file is absent (a
   * hand-deleted one, or an agent whose folder predates it).
   *
   * The timestamp travels with the text because a conversation is told how old
   * the agent's recollection is, not just what it says — see the
   * `<agent_memory updated="…">` block in `designdocs/CUSTOM_AGENTS.md` §4. The
   * hash travels with it because consolidation has to notice a user edit made
   * while it was thinking (§5, "Safety rails").
   *
   * @param slug - Identity of the agent whose memory is read.
   */
  public async readMemoryDocument(slug: string): Promise<AgentMemoryRead | null> {
    const file = this.vault.getAbstractFileByPath(getAgentMemoryPath(this.agentsFolder(), slug));
    if (!(file instanceof TFile)) return null;
    const text = await this.vault.read(file);
    const parsed = parseAgentMemoryFile(text);
    return {
      text,
      body: parsed.body,
      consolidatedThrough: parsed.consolidatedThrough,
      modifiedAtMs: file.stat.mtime,
      hash: hashMemoryContent(text),
    };
  }

  /**
   * One day of an agent's daily notes, or null when that day has none.
   *
   * @param slug - Identity of the agent whose notes are read.
   * @param date - Day to read, as `YYYY-MM-DD`.
   */
  public async readDailyNote(slug: string, date: string): Promise<DailyNoteRead | null> {
    const path = getAgentDailyNotePath(this.agentsFolder(), slug, date);
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    return { date, path, text: await this.vault.read(file), modifiedAtMs: file.stat.mtime };
  }

  /**
   * Every day this agent has notes for, oldest first.
   *
   * Files whose name is not a date are skipped: `memory/` is an ordinary vault
   * folder the user may keep their own notes in
   * (`designdocs/CUSTOM_AGENTS.md` §5).
   *
   * @param slug - Identity of the agent whose notes are listed.
   */
  public listDailyNoteDates(slug: string): string[] {
    const folder = this.vault.getAbstractFileByPath(
      getAgentMemoryFolderPath(this.agentsFolder(), slug)
    );
    if (!(folder instanceof TFolder)) return [];
    const dates: string[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile)) continue;
      const date = parseAgentDailyNoteDate(child.name);
      if (date) dates.push(date);
    }
    return dates.sort();
  }

  /**
   * The daily notes dated after `after`, oldest first — what one consolidation
   * has left to fold in.
   *
   * @param slug - Identity of the agent whose notes are read.
   * @param after - Last day already folded in, or null to read every note.
   */
  public async readDailyNotesAfter(
    slug: string,
    after: string | null
  ): Promise<AgentDailyNoteInput[]> {
    const dates = this.listDailyNoteDates(slug).filter((date) => !after || date > after);
    const notes: AgentDailyNoteInput[] = [];
    for (const date of dates) {
      const note = await this.readDailyNote(slug, date);
      if (note && note.text.trim().length > 0) notes.push({ date, text: note.text });
    }
    return notes;
  }

  /**
   * Append one flush's section to the agent's note for `date`, creating the
   * `memory/` folder and the note itself on the first write of a new day.
   *
   * @param slug - Identity of the agent whose note is appended to.
   * @param date - Day the note records, as `YYYY-MM-DD`.
   * @param section - Rendered heading and bullets to add.
   * @returns Vault-relative path of the note that was written.
   */
  public async appendDailyNote(slug: string, date: string, section: string): Promise<string> {
    const agentsFolder = this.agentsFolder();
    const path = getAgentDailyNotePath(agentsFolder, slug, date);
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const existing = await this.vault.read(file);
      await this.vault.modify(file, appendToDailyNote(existing, date, section));
    } else {
      await ensureFolderExists(this.vault, getAgentMemoryFolderPath(agentsFolder, slug));
      await this.vault.create(path, appendToDailyNote(null, date, section));
    }
    return path;
  }

  /**
   * Replace an agent's `MEMORY.md` with a consolidated body, but only if the
   * file still holds what the consolidation was handed.
   *
   * The user's own edits are always the new baseline, so a file that changed
   * while the pass was thinking is left alone and the pass is discarded; the
   * next consolidation starts from what the user wrote
   * (`designdocs/CUSTOM_AGENTS.md` §5, "Safety rails").
   *
   * @param slug - Identity of the agent whose memory is written.
   * @param body - New file body, without frontmatter.
   * @param consolidatedThrough - Last daily note folded in, as `YYYY-MM-DD`.
   * @param expectedHash - Hash of the file as the pass was handed it, or null
   *   when there was no file to read.
   */
  public async writeConsolidatedMemory(
    slug: string,
    body: string,
    consolidatedThrough: string,
    expectedHash: string | null
  ): Promise<"written" | "conflict"> {
    const memoryPath = getAgentMemoryPath(this.agentsFolder(), slug);
    const file = this.vault.getAbstractFileByPath(memoryPath);
    const text = serializeAgentMemoryFile(body, consolidatedThrough);
    if (!(file instanceof TFile)) {
      // The file the pass read is gone. Recreating it would resurrect memory the
      // user deleted, so this is a conflict like any other.
      if (expectedHash !== null) return "conflict";
      await this.vault.create(memoryPath, text);
      return "written";
    }
    if (hashMemoryContent(await this.vault.read(file)) !== expectedHash) return "conflict";
    await this.vault.modify(file, text);
    return "written";
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
    return {
      agent,
      folderPath,
      filePath,
      memoryPath,
      memoryFolderPath: getAgentMemoryFolderPath(agentsFolder, slug),
      memoryBytes: 0,
    };
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
    // Clearing the core without the notes it is distilled from would leave the
    // next consolidation to write it all back (`designdocs/CUSTOM_AGENTS.md` §5).
    const notes = this.vault.getAbstractFileByPath(record.memoryFolderPath);
    if (notes instanceof TFolder) await trashFile(this.app, notes);
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
      memoryFolderPath: getAgentMemoryFolderPath(agentsFolder, slug),
      memoryBytes: memoryFile instanceof TFile ? memoryFile.stat.size : 0,
    };
  }
}
