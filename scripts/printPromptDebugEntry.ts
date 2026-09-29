import type ChainManager from "@/LLMProviders/chainManager";
import MemoryManager from "@/LLMProviders/memoryManager";
import { ModelAdapterFactory } from "@/LLMProviders/chainRunner/utils/modelAdapter";
import { buildAgentPromptDebugReport } from "@/LLMProviders/chainRunner/utils/promptDebugService";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { ChatMessage } from "@/types/message";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { getSettings } from "@/settings/model";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import type { App } from "obsidian";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

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

function createHeadlessApp(): HeadlessApp {
  return {
    vault: {
      getRoot: () => ({ name: "root" }),
      getAbstractFileByPath: () => null,
      read: async () => "",
      getMarkdownFiles: () => [],
      getAllLoadedFiles: () => [],
      adapter: {
        mkdir: async () => {},
      },
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getLeaf: () => ({
        openFile: async () => {},
      }),
    },
  };
}

function buildChatMessage(message: string): ChatMessage {
  return {
    message,
    originalMessage: message,
    sender: "user",
    timestamp: null,
    isVisible: true,
  };
}

export async function run(args: string[]): Promise<void> {
  const userInput = args.join(" ").trim();

  if (!userInput) {
    console.error('Usage: npm run prompt:debug -- "your message here"');
    process.exitCode = 1;
    return;
  }

  const app = createHeadlessApp();
  // eslint-disable-next-line obsidianmd/no-global-this -- node-only debug script, no window available
  (global as unknown as { app: unknown }).app = app;

  initializeBuiltinTools();

  const registry = ToolRegistry.getInstance();
  const settings = getSettings();
  const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);
  const availableTools = registry.getEnabledTools(enabledToolIds, false);

  const toolDescriptions = availableTools
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");

  const memoryManager = MemoryManager.getInstance();
  const userMemoryManager = new UserMemoryManager(app as unknown as App);
  const chainContext = {
    memoryManager,
    userMemoryManager,
  } as unknown as ChainManager;

  const adapter = ModelAdapterFactory.createAdapter({
    modelName: "gpt-4",
  } as unknown as BaseChatModel);
  const report = await buildAgentPromptDebugReport({
    chainManager: chainContext,
    adapter,
    availableTools,
    toolDescriptions,
    userMessage: buildChatMessage(userInput),
  });

  console.log(report.annotatedPrompt);
}
