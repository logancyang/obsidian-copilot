import { StructuredTool } from "@langchain/core/tools";

export interface ToolMetadata {
  id: string;
  displayName: string;
  description: string;
  category: "search" | "time" | "file" | "media" | "mcp" | "memory" | "custom" | "cli";
  isAlwaysEnabled?: boolean;
  requiresVault?: boolean;
  customPromptInstructions?: string;
  copilotCommands?: string[];
  timeoutMs?: number;
  isBackground?: boolean;
  isPlusOnly?: boolean;
  requiresUserMessageContent?: boolean;
}

export interface ToolDefinition {
  tool: StructuredTool;
  metadata: ToolMetadata;
}

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

  register(definition: ToolDefinition): void {
    this.tools.set(definition.metadata.id, definition);
  }

  registerAll(definitions: ToolDefinition[]): void {
    definitions.forEach((def) => this.register(def));
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getEnabledTools(enabledToolIds: Set<string>, vaultAvailable: boolean): StructuredTool[] {
    const enabledTools: StructuredTool[] = [];

    for (const [id, definition] of this.tools) {
      const { metadata, tool } = definition;

      if (metadata.isAlwaysEnabled) {
        if (!metadata.requiresVault || vaultAvailable) {
          enabledTools.push(tool);
        }
        continue;
      }

      if (enabledToolIds.has(id)) {
        if (!metadata.requiresVault || vaultAvailable) {
          enabledTools.push(tool);
        }
      }
    }

    return enabledTools;
  }

  getToolMetadata(id: string): ToolMetadata | undefined {
    return this.tools.get(id)?.metadata;
  }

  clear(): void {
    this.tools.clear();
  }
}
