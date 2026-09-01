import { StructuredTool } from "@langchain/core/tools";

/**
 * Tool metadata for registration and UI display.
 * Contains tool configuration including execution control properties.
 */
export interface ToolMetadata {
  id: string;
  displayName: string;
  description: string;
  category: "search" | "time" | "file" | "media" | "mcp" | "memory" | "custom" | "cli";
  isAlwaysEnabled?: boolean; // Tools that are always available (e.g., time tools)
  requiresVault?: boolean; // Tools that need vault access
  customPromptInstructions?: string; // Optional custom instructions for this tool
  copilotCommands?: string[]; // Optional Copilot slash command aliases (e.g., "@vault")
  // Execution control properties
  timeoutMs?: number;
  isBackground?: boolean; // If true, tool execution is not shown to user
  isPlusOnly?: boolean; // If true, tool requires Plus subscription
  requiresUserMessageContent?: boolean; // If true, tool receives original user message for URL extraction
}

/**
 * Complete tool definition including implementation and metadata
 */
export interface ToolDefinition {
  tool: StructuredTool; // LangChain native tool - compatible with bindTools()
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
   * Returns LangChain StructuredTool instances ready for bindTools()
   */
  getEnabledTools(enabledToolIds: Set<string>, vaultAvailable: boolean): StructuredTool[] {
    const enabledTools: StructuredTool[] = [];

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
