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
import {
  AGENT_AVATAR_BASENAME,
  AGENT_AVATAR_EXTENSIONS,
  AGENT_AVATAR_UPLOAD_EXTENSION,
  AGENT_FILE_NAME,
} from "@/agents/constants";
import type { AgentDraft, AgentRecord, CustomAgent } from "@/agents/types";
import { logInfo, logWarn } from "@/logger";
import { deriveAgentsFolder } from "@/settings/copilotFolder";
import { getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, TFile, TFolder, Vault } from "obsidian";

export interface AgentMemoryRead {
  text: string;
  body: string;
  consolidatedThrough: string | null;
  modifiedAtMs: number;
  hash: string;
}

export interface DailyNoteRead {
  date: string;
  path: string;
  text: string;
  modifiedAtMs: number;
}

export class AgentFileManager {
  private readonly vault: Vault;

  constructor(private readonly app: App) {
    this.vault = app.vault;
  }

  private agentsFolder(): string {
    return deriveAgentsFolder(getSettings());
  }

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

  public getMemoryFolderPath(slug: string): string {
    return getAgentMemoryFolderPath(this.agentsFolder(), slug);
  }

  public getDailyNotePath(slug: string, date: string): string {
    return getAgentDailyNotePath(this.agentsFolder(), slug, date);
  }

  public async readAgent(slug: string): Promise<AgentRecord | null> {
    return this.readRecord(this.agentsFolder(), slug);
  }

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

  public async readDailyNote(slug: string, date: string): Promise<DailyNoteRead | null> {
    const path = getAgentDailyNotePath(this.agentsFolder(), slug, date);
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    return { date, path, text: await this.vault.read(file), modifiedAtMs: file.stat.mtime };
  }

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

  public async readDailyNotesAfter(slug: string, after: string | null): Promise<DailyNoteRead[]> {
    const dates = this.listDailyNoteDates(slug).filter((date) => !after || date > after);
    const notes: DailyNoteRead[] = [];
    for (const date of dates) {
      const note = await this.readDailyNote(slug, date);
      if (note && note.text.trim().length > 0) notes.push(note);
    }
    return notes;
  }

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
      if (expectedHash !== null) return "conflict";
      await this.vault.create(memoryPath, text);
      return "written";
    }
    if (hashMemoryContent(await this.vault.read(file)) !== expectedHash) return "conflict";
    await this.vault.modify(file, text);
    return "written";
  }

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
      avatarSrc: null,
    };
  }

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
    const notes = this.vault.getAbstractFileByPath(record.memoryFolderPath);
    if (notes instanceof TFolder) await trashFile(this.app, notes);
    logInfo(`[Agents] Cleared memory at ${record.memoryPath}`);
  }

  public async setAvatar(slug: string, image: ArrayBuffer | null): Promise<void> {
    const folderPath = getAgentFolderPath(this.agentsFolder(), slug);
    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) throw new Error(`Agent not found: ${slug}`);

    const uploadPath = `${folderPath}/${AGENT_AVATAR_BASENAME}.${AGENT_AVATAR_UPLOAD_EXTENSION}`;
    let reused: TFile | null = null;
    for (const file of listAvatarFiles(folder)) {
      if (image && file.path === uploadPath) reused = file;
      else await trashFile(this.app, file);
    }
    if (!image) return;
    if (reused) await this.vault.modifyBinary(reused, image);
    else await this.vault.createBinary(uploadPath, image);
  }

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
    const folderPath = getAgentFolderPath(agentsFolder, slug);
    const folder = this.vault.getAbstractFileByPath(folderPath);
    const avatarFile = folder instanceof TFolder ? (listAvatarFiles(folder)[0] ?? null) : null;
    return {
      agent: parseAgentFile(slug, raw),
      avatarSrc: avatarFile ? this.vault.getResourcePath(avatarFile) : null,
      folderPath,
      filePath,
      memoryPath,
      memoryFolderPath: getAgentMemoryFolderPath(agentsFolder, slug),
      memoryBytes: memoryFile instanceof TFile ? memoryFile.stat.size : 0,
    };
  }
}

function listAvatarFiles(folder: TFolder): TFile[] {
  const files = folder.children.filter(
    (child): child is TFile =>
      child instanceof TFile &&
      child.basename === AGENT_AVATAR_BASENAME &&
      AGENT_AVATAR_EXTENSIONS.includes(child.extension.toLowerCase())
  );
  const rank = (file: TFile) => AGENT_AVATAR_EXTENSIONS.indexOf(file.extension.toLowerCase());
  return files.sort((a, b) => rank(a) - rank(b));
}
