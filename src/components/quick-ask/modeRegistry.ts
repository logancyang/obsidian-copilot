/**
 * Mode registry for Quick Ask feature.
 * Manages available modes and their configurations.
 */

import type { QuickAskMode, QuickAskModeConfig } from "./types";
import { QUICK_COMMAND_SYSTEM_PROMPT } from "@/commands/quickCommandPrompts";
import { askModeConfig, editModeConfig, editDirectModeConfig } from "./modes";

/**
 * Registry class for managing Quick Ask modes.
 */
class QuickAskModeRegistry {
  private modes = new Map<QuickAskMode, QuickAskModeConfig>();

  constructor() {
    // Register built-in modes
    this.register(askModeConfig);
    this.register(editModeConfig);
    this.register(editDirectModeConfig);
  }

  /**
   * Registers a mode configuration.
   */
  register(config: QuickAskModeConfig): void {
    this.modes.set(config.id, config);
  }

  /**
   * Gets a mode configuration by ID.
   */
  get(id: QuickAskMode): QuickAskModeConfig | undefined {
    return this.modes.get(id);
  }

  /**
   * Gets all registered modes.
   */
  getAll(): QuickAskModeConfig[] {
    return Array.from(this.modes.values());
  }

  /**
   * Gets modes available based on selection state.
   */
  getAvailable(hasSelection: boolean): QuickAskModeConfig[] {
    return this.getAll().filter((mode) => !mode.requiresSelection || hasSelection);
  }

  /**
   * Gets the system prompt for a mode.
   */
  getSystemPrompt(id: QuickAskMode): string {
    const mode = this.get(id);
    return mode?.systemPrompt ?? QUICK_COMMAND_SYSTEM_PROMPT;
  }
}

// Create singleton instance
export const modeRegistry = new QuickAskModeRegistry();
