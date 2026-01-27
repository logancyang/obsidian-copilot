import MemoryManager from "@/LLMProviders/memoryManager";
import { ModelAdapterFactory } from "@/LLMProviders/chainRunner/utils/modelAdapter";
import { buildAgentPromptDebugReport } from "@/LLMProviders/chainRunner/utils/promptDebugService";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { ChatMessage } from "@/types/message";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { getSettings } from "@/settings/model";
import { UserMemoryManager } from "@/memory/UserMemoryManager";

interface HeadlessApp {
  vault: {
    getRoot: () => { name: string };
    getAbstractFileByPath: (path: string) => null;
    read: (file: unknown) => Promise<string>;
    getMarkdownFiles: () => unknown[];
    getAllLoadedFiles: () => unknown[];
    adapter: {
      mkdir: (path: string) => Promise<void>;
    };
  };
  metadataCache: {
    getFirstLinkpathDest: () => null;
    getFileCache: () => null;
  };
  workspace: {
    getActiveFile: () => null;
    getLeaf: () => { openFile: () => Promise<void> };
  };
}

/**
 * Create a minimal Obsidian app stub suitable for CLI usage.
 *
 * The autonomous agent only needs vault lookups and metadata cache reads, so this
 * provides no-op implementations that satisfy those expectations.
 */
function createHeadlessApp(): HeadlessApp {
  return {
    vault: {
      getRoot: () => ({ name: "root" }),
      getAbstractFileByPath: () => null,
      read: async () => "",
      getMarkdownFiles: () => [],
      getAllLoadedFiles: () => [],
      adapter: {
        mkdir: async () => {
          /* no-op */
        },
      },
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getLeaf: () => ({
        openFile: async () => {
          /* no-op */
        },
      }),
    },
  };
}

/**
 * Format a plain user message into the ChatMessage shape used by the agent.
 *
 * @param message - Raw user text to analyse.
 * @returns Minimal chat message.
 */
function buildChatMessage(message: string): ChatMessage {
  return {
    message,
    originalMessage: message,
    sender: "user",
    timestamp: null,
    isVisible: true,
  };
}

/**
 * Generate the annotated prompt debug report for a given user input.
 *
 * @param args - CLI arguments (expects the user prompt as the concatenated string).
 */
export async function run(args: string[]): Promise<void> {
  const userInput = args.join(" ").trim();

  if (!userInput) {
    console.error('Usage: npm run prompt:debug -- "your message here"');
    process.exitCode = 1;
    return;
  }

  const app = createHeadlessApp();
  (globalThis as any).app = app;

  initializeBuiltinTools();

  const registry = ToolRegistry.getInstance();
  const settings = getSettings();
  const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);
  const availableTools = registry.getEnabledTools(enabledToolIds, false);

  // Generate simple tool descriptions (native tool calling handles schema via bindTools)
  const toolDescriptions = availableTools
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");

  const memoryManager = MemoryManager.getInstance();
  const userMemoryManager = new UserMemoryManager(app as any);
  const chainContext = {
    memoryManager,
    userMemoryManager,
  } as any;

  const adapter = ModelAdapterFactory.createAdapter({ modelName: "gpt-4" } as any);
  const report = await buildAgentPromptDebugReport({
    chainManager: chainContext,
    adapter,
    availableTools,
    toolDescriptions,
    userMessage: buildChatMessage(userInput),
  });

  console.log(report.annotatedPrompt);
}
