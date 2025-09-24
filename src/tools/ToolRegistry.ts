import { SimpleTool } from "./SimpleTool";

/**
 * Tool metadata for registration and UI display
 */
export interface ToolMetadata {
  id: string;
  displayName: string;
  description: string;
  category: "search" | "time" | "file" | "media" | "mcp" | "memory" | "custom";
  isAlwaysEnabled?: boolean; // Tools that are always available (e.g., time tools)
  requiresVault?: boolean; // Tools that need vault access
  customPromptInstructions?: string; // Optional custom instructions for this tool
  copilotCommands?: string[]; // Optional Copilot slash command aliases (e.g., "@vault")
}

/**
 * Complete tool definition including implementation and metadata
 */
export interface ToolDefinition {
  tool: SimpleTool<any, any>;
  metadata: ToolMetadata;
}

/**
 * Central registry for all tools available to the autonomous agent
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ToolDefinition> = new Map();

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a tool with the registry
   */
  register(definition: ToolDefinition): void {
    this.tools.set(definition.metadata.id, definition);
  }

  /**
   * Register multiple tools at once
   */
  registerAll(definitions: ToolDefinition[]): void {
    definitions.forEach((def) => this.register(def));
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools filtered by enabled status
   */
  getEnabledTools(enabledToolIds: Set<string>, vaultAvailable: boolean): SimpleTool<any, any>[] {
    const enabledTools: SimpleTool<any, any>[] = [];

    for (const [id, definition] of this.tools) {
      const { metadata, tool } = definition;

      // Always include tools marked as always enabled
      if (metadata.isAlwaysEnabled) {
        // Skip vault-required tools if vault is not available
        if (!metadata.requiresVault || vaultAvailable) {
          enabledTools.push(tool);
        }
        continue;
      }

      // Include user-enabled tools
      if (enabledToolIds.has(id)) {
        // Skip vault-required tools if vault is not available
        if (!metadata.requiresVault || vaultAvailable) {
          enabledTools.push(tool);
        }
      }
    }

    return enabledTools;
  }

  /**
   * Get tool metadata by category for UI organization
   */
  getToolsByCategory(): Map<string, ToolDefinition[]> {
    const byCategory = new Map<string, ToolDefinition[]>();

    for (const definition of this.tools.values()) {
      const category = definition.metadata.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(definition);
    }

    return byCategory;
  }

  /**
   * Get configurable tools (excludes always-enabled tools)
   */
  getConfigurableTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((def) => !def.metadata.isAlwaysEnabled);
  }

  /**
   * Build a map of Copilot command aliases to tool definitions.
   *
   * @returns Map keyed by lower-case Copilot command aliases pointing to their tool definitions.
   */
  getCopilotCommandMappings(): Map<string, ToolDefinition> {
    const mappings = new Map<string, ToolDefinition>();

    for (const definition of this.tools.values()) {
      const commands = definition.metadata.copilotCommands;

      if (!commands) {
        continue;
      }

      for (const command of commands) {
        const normalizedCommand = command.toLowerCase();

        if (!mappings.has(normalizedCommand)) {
          mappings.set(normalizedCommand, definition);
        }
      }
    }

    return mappings;
  }

  /**
   * Get tool metadata by ID
   */
  getToolMetadata(id: string): ToolMetadata | undefined {
    return this.tools.get(id)?.metadata;
  }

  /**
   * Clear the registry (useful for testing)
   */
  clear(): void {
    this.tools.clear();
  }
}
