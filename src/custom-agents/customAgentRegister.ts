import { logInfo, logWarn } from "@/logger";
import { TFile, Vault } from "obsidian";
import {
  getAgentsFolder,
  isAgentFile,
  loadAllCustomAgents,
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

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Initialize: load all agents and set up file watchers.
   */
  async initialize(): Promise<void> {
    await this.ensureAgentsFolder();
    const agents = await loadAllCustomAgents();
    updateCachedCustomAgents(agents);

    // Watch for file changes in the agents folder
    this.vault.on("create", async (file) => {
      if (file instanceof TFile && isAgentFile(file)) {
        // Small delay to let metadata cache populate
        setTimeout(async () => {
          const agent = await parseAgentFile(file);
          if (agent) {
            upsertCachedCustomAgent(agent);
            logInfo(`[CustomAgents] Agent created: ${agent.title}`);
          }
        }, 200);
      }
    });

    this.vault.on("modify", async (file) => {
      if (file instanceof TFile && isAgentFile(file)) {
        setTimeout(async () => {
          const agent = await parseAgentFile(file);
          if (agent) {
            upsertCachedCustomAgent(agent);
            logInfo(`[CustomAgents] Agent modified: ${agent.title}`);
          }
        }, 200);
      }
    });

    this.vault.on("delete", (file) => {
      if (file instanceof TFile && isAgentFile(file)) {
        deleteCachedCustomAgent(file.basename);
        logInfo(`[CustomAgents] Agent deleted: ${file.basename}`);
      }
    });

    this.vault.on("rename", async (file, oldPath) => {
      if (file instanceof TFile) {
        const folder = getAgentsFolder();
        // Handle rename within agents folder
        if (oldPath.startsWith(folder + "/")) {
          const oldName = oldPath.split("/").pop()?.replace(".md", "") || "";
          deleteCachedCustomAgent(oldName);
        }
        if (isAgentFile(file)) {
          setTimeout(async () => {
            const agent = await parseAgentFile(file);
            if (agent) {
              upsertCachedCustomAgent(agent);
              logInfo(`[CustomAgents] Agent renamed: ${agent.title}`);
            }
          }, 200);
        }
      }
    });

    logInfo(`[CustomAgents] Registered ${agents.length} custom agents`);
  }

  /**
   * Ensure the agents folder exists and create starter agents if empty.
   */
  private async ensureAgentsFolder(): Promise<void> {
    const folder = getAgentsFolder();
    const exists = this.vault.getAbstractFileByPath(folder);

    if (!exists) {
      try {
        await this.vault.createFolder(folder);
        logInfo(`[CustomAgents] Created agents folder: ${folder}`);

        // Create starter agents
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
}
