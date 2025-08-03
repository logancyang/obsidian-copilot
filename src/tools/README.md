# Tool System Documentation

## Overview

The Copilot tool system uses a centralized registry pattern that makes it easy to add new tools, including future MCP (Model Context Protocol) tools. All tools are managed through a singleton `ToolRegistry` that provides a unified interface for tool discovery, configuration, and execution.

## Tool Prompt Architecture

### How Tool Instructions Flow to the LLM

The system uses a three-layer approach for providing tool instructions to LLMs:

1. **Tool Schema Descriptions** (in tool implementations like `ComposerTools.ts`)

   - Defined in the Zod schema's `.describe()` method
   - Appears in the system prompt under "Available tools:"
   - Primary source of detailed parameter documentation
   - Should be comprehensive and self-contained

2. **Custom Prompt Instructions** (in `builtinTools.ts`)

   - Defined in `ToolMetadata.customPromptInstructions`
   - Collected by the model adapter and included in system prompt
   - Used for high-level guidance and tool-specific quirks
   - Should complement, not duplicate, schema descriptions

3. **Model-Specific Adaptations** (in `modelAdapter.ts`)
   - Applied by model adapters (GPT, Claude, Gemini)
   - Includes model-specific examples and reminders
   - Can add aggressive prompting for models that need it
   - Last resort when general instructions aren't sufficient

### Example Flow

For the `replaceInFile` tool:

```typescript
// 1. Schema Description (ComposerTools.ts)
diff: z.string().describe(`(Required) One or more SEARCH/REPLACE blocks...
  [Detailed format instructions, rules, examples]`);

// 2. Custom Instructions (builtinTools.ts)
customPromptInstructions: `When using replaceInFile, provide exact SEARCH/REPLACE blocks...
  [High-level reminders]`;

// 3. Model Adapter (modelAdapter.ts - GPT specific)
if (hasComposerTools) {
  // Add GPT-specific examples and aggressive prompting
}
```

### Why Two Layers: Schema Descriptions vs Custom Instructions

The separation between schema descriptions and custom prompt instructions serves important purposes:

1. **Separation of Concerns**

   - **Schema**: Defines the technical contract (parameters, types, basic usage)
   - **Custom Instructions**: Provides behavioral guidance (when/how to use, patterns, edge cases)

2. **MCP Tool Compatibility**

   - MCP tools come with their own schema that shouldn't be modified
   - Custom instructions can be added without touching the external tool's schema
   - Enables behavioral customization for tools from external sources

3. **Flexibility**

   - Schema descriptions are part of the tool implementation (harder to change)
   - Custom instructions can be modified without changing tool code
   - Different vaults or users might need different behavioral guidance

4. **Example**

   ```typescript
   // Schema (immutable, from tool implementation)
   salientTerms: z.array(z.string()).describe("Keywords to find in notes");

   // Custom Instructions (flexible, behavioral guidance)
   customPromptInstructions: `
   - Extract terms from user's original query only
   - Exclude common words like "what", "I", "do"
   - Preserve original language - don't translate
   `;
   ```

### Best Practices

1. **Schema Descriptions: Focus on Technical Contract**

   - Define parameter types and formats clearly
   - Provide examples of valid parameter values
   - Describe what each parameter does
   - Keep it technical and factual

2. **Custom Instructions: Add Behavioral Guidance**

   - Explain when to use this tool vs others
   - Highlight common usage patterns
   - Warn about edge cases or common mistakes
   - Keep it concise and action-oriented

3. **Model Adapters: Last Resort**
   - Only when a specific model consistently fails
   - Test if improving schema or custom instructions helps first
   - Keep adaptations minimal and model-specific

## Current Implementation

### Core Files

- `src/tools/ToolRegistry.ts` - Central registry for all tools
- `src/tools/builtinTools.ts` - Built-in tool definitions and initialization
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` - Tool execution in the agent
- `src/settings/v2/components/ToolSettingsSection.tsx` - Settings UI for tool configuration

### Tool Registry Pattern

The `ToolRegistry` is a singleton that manages all tools:

```typescript
class ToolRegistry {
  static getInstance(): ToolRegistry;
  register(definition: ToolDefinition): void;
  registerAll(definitions: ToolDefinition[]): void;
  getAllTools(): ToolDefinition[];
  getEnabledTools(enabledToolIds: Set<string>, vaultAvailable: boolean): SimpleTool<any, any>[];
  getToolsByCategory(): Map<string, ToolDefinition[]>;
  getConfigurableTools(): ToolDefinition[];
  getToolMetadata(id: string): ToolMetadata | undefined;
  clear(): void;
}
```

### Tool Definition Structure

```typescript
interface ToolDefinition {
  tool: SimpleTool<any, any>; // The actual tool implementation
  metadata: ToolMetadata; // UI and configuration metadata
}

interface ToolMetadata {
  id: string; // Unique identifier
  displayName: string; // Shown in UI
  description: string; // Help text
  category: "search" | "time" | "file" | "media" | "mcp" | "custom";
  isAlwaysEnabled?: boolean; // If true, not configurable (e.g., time tools)
  requiresVault?: boolean; // Needs vault access
  customPromptInstructions?: string; // Tool-specific prompts
}
```

## Adding a New Built-in Tool

### 1. Implement the Tool

Create your tool following the `SimpleTool` interface:

```typescript
// Example: New built-in tool
import { z } from "zod";
import { SimpleTool } from "./SimpleTool";

export const myNewTool: SimpleTool<{ input: string }, { result: string }> = {
  name: "myNewTool",
  description: "Description for the LLM to understand when to use this tool",
  schema: z.object({
    input: z.string().describe("The input parameter description"),
  }),
  func: async (params) => {
    // Tool implementation
    const result = await performOperation(params.input);
    return { result };
  },
};
```

### 2. Add to Built-in Tools

Update `src/tools/builtinTools.ts`:

```typescript
export const BUILTIN_TOOLS: ToolDefinition[] = [
  // ... existing tools ...
  {
    tool: myNewTool,
    metadata: {
      id: "myNewTool",
      displayName: "My New Tool",
      description: "User-friendly description for settings UI",
      category: "custom", // Choose appropriate category
      // Optional flags:
      isAlwaysEnabled: false, // Set true if tool should always be available
      requiresVault: true, // Set true if tool needs vault access
      customPromptInstructions: "Special instructions for the AI when using this tool",
    },
  },
];
```

### 3. Update Default Settings (if configurable)

If the tool is configurable (not always-enabled), add its ID to the default enabled tools in `src/constants.ts`:

```typescript
autonomousAgentEnabledToolIds: [
  "localSearch",
  "webSearch",
  "pomodoro",
  "youtubeTranscription",
  "writeToFile",
  "myNewTool"  // Add your tool ID here
],
```

## Adding MCP Tools (Future Implementation)

### 1. MCP Tool Wrapper

Create a wrapper to convert MCP tools to the SimpleTool interface:

```typescript
function createMcpToolWrapper(serverName: string, mcpTool: McpTool): SimpleTool<any, any> {
  return {
    name: `${serverName}_${mcpTool.name}`,
    description: mcpTool.description || `MCP tool from ${serverName}`,
    schema: convertMcpSchemaToZod(mcpTool.inputSchema),
    func: async (params) => {
      // Call the MCP server
      const result = await mcpHub.callTool(serverName, mcpTool.name, params);

      // Convert MCP response to expected format
      return {
        result: formatMcpResponse(result),
      };
    },
  };
}
```

### 2. Dynamic MCP Tool Registration

Register MCP tools when servers connect:

```typescript
// In your MCP initialization code
export async function registerMcpServerTools(serverName: string, mcpTools: McpTool[]) {
  const registry = ToolRegistry.getInstance();

  for (const mcpTool of mcpTools) {
    registry.register({
      tool: createMcpToolWrapper(serverName, mcpTool),
      metadata: {
        id: `mcp_${serverName}_${mcpTool.name}`,
        displayName: mcpTool.displayName || mcpTool.name,
        description: mcpTool.description || `MCP tool from ${serverName}`,
        category: "mcp",
        // MCP tools are user-configurable by default
        isAlwaysEnabled: false,
        // Add any MCP-specific prompt instructions
        customPromptInstructions: mcpTool.systemPrompt,
      },
    });
  }
}

// When MCP server disconnects
export function unregisterMcpServerTools(serverName: string) {
  const registry = ToolRegistry.getInstance();
  const allTools = registry.getAllTools();

  // Remove tools from this server
  const toolsToKeep = allTools.filter((t) => !t.metadata.id.startsWith(`mcp_${serverName}_`));

  registry.clear();
  registry.registerAll(toolsToKeep);

  // Re-initialize built-in tools
  initializeBuiltinTools(app.vault);
}
```

### 3. Schema Conversion Helper

Convert MCP JSON Schema to Zod schema:

```typescript
function convertMcpSchemaToZod(jsonSchema: any): z.ZodSchema {
  // Basic implementation - extend as needed
  if (jsonSchema.type === "object") {
    const shape: any = {};

    for (const [key, prop] of Object.entries(jsonSchema.properties || {})) {
      const propSchema = prop as any;

      if (propSchema.type === "string") {
        shape[key] = z.string();
        if (propSchema.description) {
          shape[key] = shape[key].describe(propSchema.description);
        }
      } else if (propSchema.type === "number") {
        shape[key] = z.number();
      } else if (propSchema.type === "boolean") {
        shape[key] = z.boolean();
      } else if (propSchema.type === "array") {
        shape[key] = z.array(z.any()); // Simplification
      } else if (propSchema.type === "object") {
        shape[key] = z.object({});
      }

      // Handle optional properties
      if (!jsonSchema.required?.includes(key)) {
        shape[key] = shape[key].optional();
      }
    }

    return z.object(shape);
  }

  // Fallback for other types
  return z.any();
}
```

### 4. Settings Storage for MCP Tools

MCP tool preferences are stored in the same array as built-in tools:

```typescript
// When enabling/disabling MCP tools:
function updateMcpToolSetting(toolId: string, enabled: boolean) {
  const settings = getSettings();
  const enabledIds = new Set(settings.autonomousAgentEnabledToolIds || []);

  if (enabled) {
    enabledIds.add(toolId);
  } else {
    enabledIds.delete(toolId);
  }

  updateSetting("autonomousAgentEnabledToolIds", Array.from(enabledIds));
}
```

## How the System Works

### Tool Discovery Flow

1. **Initialization**: `initializeBuiltinTools()` registers all built-in tools
2. **MCP Connection**: When MCP servers connect, their tools are dynamically registered
3. **Settings UI**: `ToolSettingsSection` component reads from the registry to generate UI
4. **Tool Execution**: `AutonomousAgentChainRunner.getAvailableTools()` filters tools based on settings

### Tool Execution Flow

1. Agent calls `getAvailableTools()` which:

   - Gets enabled tool IDs from settings array (`autonomousAgentEnabledToolIds`)
   - Calls `registry.getEnabledTools()` to get actual tool implementations
   - Filters based on vault availability and user preferences

2. Model adapter receives tool list and:

   - Generates tool descriptions for the system prompt
   - Includes tool-specific instructions based on enabled tools

3. When tool is called:
   - XML parsing extracts tool name and parameters
   - Tool is executed via its `func` implementation
   - Results are formatted and returned to the agent

## Benefits of This Architecture

1. **Modularity**: Each tool is self-contained with metadata
2. **Extensibility**: New tools can be added without core changes
3. **Backward Compatibility**: Settings structure preserved while supporting new tools
4. **Dynamic UI**: Settings automatically adapt to registered tools
5. **Smart Prompts**: System prompts include only relevant tool instructions
6. **MCP Ready**: Architecture supports dynamic tool registration from external sources

## Testing Your Tools

```typescript
// Test tool registration
const registry = ToolRegistry.getInstance();
registry.clear();
initializeBuiltinTools(vault);

// Verify tool is registered
const allTools = registry.getAllTools();
console.log(
  "Registered tools:",
  allTools.map((t) => t.metadata.id)
);

// Test with settings
const enabledIds = new Set(["myNewTool", "localSearch"]);
const enabledTools = registry.getEnabledTools(enabledIds, true);
console.log(
  "Enabled tools:",
  enabledTools.map((t) => t.name)
);
```

This architecture provides a clean, extensible foundation for the tool system while maintaining simplicity and backward compatibility.

## Summary

The tool system's layered approach allows for:

- Clear, comprehensive tool documentation at the schema level
- Model-agnostic instructions that work for most LLMs
- Targeted model-specific adaptations when necessary
- Easy extension for new tools without modifying core infrastructure
