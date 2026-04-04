import { logInfo, logWarn } from "@/logger";
import { EventRef, TFile, TFolder, Vault } from "obsidian";
import {
  getAgentsFolder,
  isAgentFile,
  parseAgentFile,
  createAgentFile,
  getStarterAgents,
} from "./customAgentUtils";
import {
  updateCachedCustomAgents,
  upsertCachedCustomAgent,
  deleteCachedCustomAgent,
} from "./state";

/**
 * Registers custom agents from the vault and watches for changes.
 * Call during plugin initialization after the vault is ready.
 */
export class CustomAgentRegister {
  private vault: Vault;
  private eventRefs: EventRef[] = [];
  private modifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Initialize: load all agents and set up file watchers.
   */
  async initialize(): Promise<void> {
    await this.ensureAgentsFolder();
    const agents = await this.loadAgentsFromFolder();
    updateCachedCustomAgents(agents);

    this.eventRefs.push(
      this.vault.on("create", (file) => {
        if (file instanceof TFile && isAgentFile(file)) {
          this.debouncedParse(file, "created");
        }
      })
    );

    this.eventRefs.push(
      this.vault.on("modify", (file) => {
        if (file instanceof TFile && isAgentFile(file)) {
          this.debouncedParse(file, "modified");
        }
      })
    );

    this.eventRefs.push(
      this.vault.on("delete", (file) => {
        if (file instanceof TFile && isAgentFile(file)) {
          deleteCachedCustomAgent(file.basename);
          logInfo(`[CustomAgents] Agent deleted: ${file.basename}`);
        }
      })
    );

    this.eventRefs.push(
      this.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          const folder = getAgentsFolder();
          if (oldPath.startsWith(folder + "/")) {
            const oldName = oldPath.split("/").pop()?.replace(".md", "") || "";
            deleteCachedCustomAgent(oldName);
          }
          if (isAgentFile(file)) {
            this.debouncedParse(file, "renamed");
          }
        }
      })
    );

    logInfo(`[CustomAgents] Registered ${agents.length} custom agents`);
  }

  /**
   * Clean up event listeners. Call on plugin unload.
   */
  cleanup(): void {
    for (const ref of this.eventRefs) {
      this.vault.offref(ref);
    }
    this.eventRefs = [];
    for (const timer of this.modifyTimers.values()) {
      clearTimeout(timer);
    }
    this.modifyTimers.clear();
  }

  /**
   * Debounced parse of an agent file. Coalesces rapid events on the same file.
   */
  private debouncedParse(file: TFile, action: string): void {
    const existing = this.modifyTimers.get(file.path);
    if (existing) clearTimeout(existing);

    this.modifyTimers.set(
      file.path,
      setTimeout(async () => {
        this.modifyTimers.delete(file.path);
        const agent = await parseAgentFile(file);
        if (agent) {
          upsertCachedCustomAgent(agent);
          logInfo(`[CustomAgents] Agent ${action}: ${agent.title}`);
        }
      }, 500)
    );
  }

  /**
   * Load agents from the agents folder using folder children (not full vault scan).
   */
  private async loadAgentsFromFolder() {
    const folder = getAgentsFolder();
    const folderObj = this.vault.getAbstractFileByPath(folder);

    if (!folderObj || !(folderObj instanceof TFolder)) {
      return [];
    }

    const agents = [];
    for (const child of folderObj.children) {
      if (child instanceof TFile && child.extension === "md") {
        const agent = await parseAgentFile(child);
        if (agent && agent.enabled) {
          agents.push(agent);
        }
      }
    }

    agents.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    logInfo(`[CustomAgents] Loaded ${agents.length} agents from ${folder}`);
    return agents;
  }

  /**
   * Ensure the agents folder exists and create starter agents if empty.
   */
  private async ensureAgentsFolder(): Promise<void> {
    const folder = getAgentsFolder();
    try {
      const existing = this.vault.getAbstractFileByPath(folder);
      if (existing) return;

      await this.vault.createFolder(folder);
      logInfo(`[CustomAgents] Created agents folder: ${folder}`);

      const starters = getStarterAgents();
      for (const agent of starters) {
        await createAgentFile(agent);
      }
      logInfo(`[CustomAgents] Created ${starters.length} starter agents`);
    } catch (error) {
      logWarn(`[CustomAgents] Failed to create agents folder: ${error}`);
    }
  }
}
