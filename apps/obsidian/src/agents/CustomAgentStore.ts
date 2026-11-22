import {
  type CustomAgentProfile,
  deriveAgentSlug,
  encodeFace,
  findAgentNameConflict,
  FACE_FILE_NAME,
  type FaceImage,
  INSTRUCTIONS_FILE_NAME,
  MEMORY_FILE_NAME,
  NEUTRAL_FACE_SRC,
  parseInstructionsFile,
  serializeInstructionsFile,
  serializeModel,
} from "@/agents/customAgentFiles";
import { getCustomAgentsGate, subscribeToCustomAgentsGate } from "@/agents/customAgentsGate";
import { logInfo, logWarn } from "@/logger";
import { getEffectiveCopilotFolder } from "@/settings/copilotFolder";
import { ensureFolderExists } from "@/utils";
import { trashFile } from "@/utils/vaultAdapterUtils";
import {
  normalizePath,
  TFile,
  TFolder,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";

const AGENTS_SUBFOLDER = "teammates";

interface CustomAgentPaths {
  folderPath: string;
  instructionsPath: string;
  memoryPath: string;
  facePath: string;
}

export interface CustomAgent extends CustomAgentProfile, CustomAgentPaths {
  slug: string;
  instruction: string;
  faceSrc: string;
}

export interface NewCustomAgent extends CustomAgentProfile {
  instruction: string;
  face?: FaceImage;
}

export interface CustomAgentSessionFiles {
  instruction: string;
  memory: string;
}

const EMPTY_AGENTS: readonly CustomAgent[] = Object.freeze([]);

export class CustomAgentStore {
  private agents = EMPTY_AGENTS;
  private readonly listeners = new Set<() => void>();
  private eventRefs: EventRef[] | null = null;
  private scan: Promise<void> | null = null;
  private rescanRequested = false;

  constructor(private readonly app: App) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getAgents = (): readonly CustomAgent[] => this.agents;

  start(): Promise<void> {
    if (this.eventRefs) return this.scan ?? Promise.resolve();
    const { vault } = this.app;
    const onChange = (file: TAbstractFile, oldPath?: string): void => {
      if (this.isInAgentsFolder(file.path) || (oldPath && this.isInAgentsFolder(oldPath))) {
        void this.refresh();
      }
    };
    this.eventRefs = [
      vault.on("create", onChange),
      vault.on("modify", onChange),
      vault.on("delete", onChange),
      vault.on("rename", onChange),
    ];
    return this.refresh();
  }

  stop(): void {
    if (!this.eventRefs) return;
    this.eventRefs.forEach((ref) => this.app.vault.offref(ref));
    this.eventRefs = null;
    this.publish(EMPTY_AGENTS);
  }

  private refresh(): Promise<void> {
    if (this.scan) {
      this.rescanRequested = true;
      return this.scan;
    }
    this.scan = this.scanUntilSettled();
    return this.scan;
  }

  async createAgent({ face, instruction, ...profile }: NewCustomAgent): Promise<string> {
    const faceBytes = face && (await encodeFace(face));
    assertNotLocked();
    const conflict = findAgentNameConflict(this.agents, this.folderNames(), profile.name);
    if (conflict) throw new Error(conflict);
    const slug = deriveAgentSlug(profile.name);
    const paths = this.pathsFor(slug);
    await ensureFolderExists(this.app.vault, paths.folderPath);
    await this.app.vault.create(
      paths.instructionsPath,
      serializeInstructionsFile(profile, instruction)
    );
    if (faceBytes) await this.app.vault.createBinary(paths.facePath, faceBytes);
    logInfo(`[Custom agents] Created ${paths.folderPath}`);
    await this.refresh();
    return slug;
  }

  folderNames(): string[] {
    const folder = this.app.vault.getAbstractFileByPath(this.agentsFolder());
    return folder instanceof TFolder ? folder.children.map((child) => child.name) : [];
  }

  async updateAgent(slug: string, { model, ...text }: Partial<CustomAgentProfile>): Promise<void> {
    assertNotLocked();
    const file = this.app.vault.getAbstractFileByPath(this.pathsFor(slug).instructionsPath);
    if (!(file instanceof TFile)) throw new Error(`No agent at ${slug}.`);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      Object.assign(frontmatter, text);
      if (model !== undefined) frontmatter.model = serializeModel(model);
    });
    await this.refresh();
  }

  async saveFace(slug: string, face: FaceImage): Promise<void> {
    const bytes = await encodeFace(face);
    assertNotLocked();
    const { facePath } = this.pathsFor(slug);
    const existing = this.app.vault.getAbstractFileByPath(facePath);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, bytes);
    else await this.app.vault.createBinary(facePath, bytes);
    await this.refresh();
  }

  async deleteAgent(slug: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(this.pathsFor(slug).folderPath);
    if (!folder) throw new Error(`No agent at ${slug}.`);
    await trashFile(this.app, folder);
    logInfo(`[Custom agents] Moved ${folder.path} to the trash`);
    await this.refresh();
  }

  async loadForSession(slug: string): Promise<CustomAgentSessionFiles | null> {
    const { instructionsPath, memoryPath } = this.pathsFor(slug);
    const { vault } = this.app;
    const instructions = vault.getAbstractFileByPath(instructionsPath);
    if (!(instructions instanceof TFile)) return null;
    const memory = vault.getAbstractFileByPath(memoryPath);
    return {
      instruction: parseInstructionsFile(await vault.read(instructions)).instruction,
      memory: memory instanceof TFile ? await vault.read(memory) : "",
    };
  }

  private async scanUntilSettled(): Promise<void> {
    try {
      do {
        this.rescanRequested = false;
        const agents = await this.readAgents();
        if (this.eventRefs) this.publish(agents);
      } while (this.rescanRequested && this.eventRefs);
    } finally {
      this.scan = null;
    }
  }

  private async readAgents(): Promise<CustomAgent[]> {
    const folder = this.app.vault.getAbstractFileByPath(this.agentsFolder());
    if (!(folder instanceof TFolder)) return [];
    const agents = await Promise.all(
      folder.children
        .filter((child): child is TFolder => child instanceof TFolder)
        .map((child) => this.readAgent(child.name))
    );
    return agents
      .filter((agent): agent is CustomAgent => agent !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  private async readAgent(slug: string): Promise<CustomAgent | null> {
    const paths = this.pathsFor(slug);
    const { vault } = this.app;
    const file = vault.getAbstractFileByPath(paths.instructionsPath);
    if (!(file instanceof TFile)) return null;
    let content: string;
    try {
      content = await vault.read(file);
    } catch (error) {
      // Sync can remove a file between listing the folder and reading it; the other agents still list.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
      logWarn(`[Custom agents] Could not read ${paths.instructionsPath}`, error);
      return null;
    }
    const { name, ...parsed } = parseInstructionsFile(content);
    const face = vault.getAbstractFileByPath(paths.facePath);
    return {
      slug,
      name: name || slug,
      ...parsed,
      ...paths,
      faceSrc: face instanceof TFile ? vault.getResourcePath(face) : NEUTRAL_FACE_SRC,
    };
  }

  private publish(agents: readonly CustomAgent[]): void {
    if (JSON.stringify(agents) === JSON.stringify(this.agents)) return;
    this.agents = agents.length > 0 ? Object.freeze(agents) : EMPTY_AGENTS;
    this.listeners.forEach((listener) => listener());
  }

  private agentsFolder(): string {
    // A surface left open when the license loses custom agents must not read or write the folder.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
    if (!this.eventRefs) throw new Error("Copilot Teammates is not available.");
    return customAgentsFolderPath();
  }

  private isInAgentsFolder(path: string): boolean {
    const folder = this.agentsFolder();
    return path === folder || path.startsWith(`${folder}/`);
  }

  private pathsFor(slug: string): CustomAgentPaths {
    // An empty or multi-segment slug from a caller would make delete trash the whole agents folder or another path.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
    if (!slug || slug === "." || slug === ".." || /[\\/]/.test(slug)) {
      throw new Error(`No agent at ${slug}.`);
    }
    const folderPath = normalizePath(`${this.agentsFolder()}/${slug}`);
    return {
      folderPath,
      instructionsPath: `${folderPath}/${INSTRUCTIONS_FILE_NAME}`,
      memoryPath: `${folderPath}/${MEMORY_FILE_NAME}`,
      facePath: `${folderPath}/${FACE_FILE_NAME}`,
    };
  }
}

// A vault whose license isn't valid for custom agents shows its agents, and only Delete may change their files.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/950
function assertNotLocked(): void {
  if (getCustomAgentsGate() === "locked") throw new Error("Copilot Teammates is locked.");
}

export function customAgentsFolderPath(): string {
  return normalizePath(`${getEffectiveCopilotFolder()}/${AGENTS_SUBFOLDER}`);
}

export function runCustomAgentStoreWhileEnabled(store: CustomAgentStore): () => void {
  const sync = (): void => {
    const gate = getCustomAgentsGate();
    if (gate === "full" || gate === "locked") void store.start();
    else store.stop();
  };
  sync();
  const unsubscribe = subscribeToCustomAgentsGate(sync);
  return () => {
    unsubscribe();
    store.stop();
  };
}
