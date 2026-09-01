import type { App } from "obsidian";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { fetchAllSystemPrompts, loadAllSystemPrompts } from "@/system-prompts/systemPromptUtils";
import { logInfo } from "@/logger";

/**
 * Owns the system-prompt loading lifecycle used by the vault event register.
 * Initializes the shared cache at startup and provides cache-neutral snapshots
 * for callers that coordinate their own cache replacement.
 */
export class SystemPromptManager {
  private static instance: SystemPromptManager;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(app?: App): SystemPromptManager {
    if (!SystemPromptManager.instance) {
      if (!app) {
        throw new Error("App is required for first initialization");
      }
      SystemPromptManager.instance = new SystemPromptManager(app);
    }
    return SystemPromptManager.instance;
  }

  /**
   * Initialize the manager by loading all prompts
   */
  public async initialize(): Promise<void> {
    logInfo("Initializing SystemPromptManager");
    await loadAllSystemPrompts(this.app);
  }

  /**
   * Fetch all prompts from file system without updating cache
   * Use this when you need to control cache updates yourself (e.g., for latest-wins semantics)
   */
  public async fetchPrompts(): Promise<UserSystemPrompt[]> {
    return await fetchAllSystemPrompts(this.app);
  }
}
