import ChainManager from "@/LLMProviders/chainManager";
import { getSystemPromptWithMemory } from "@/system-prompts/systemPromptBuilder";
import { ToolMetadata, ToolRegistry } from "@/tools/ToolRegistry";
import { ChatMessage } from "@/types/message";
import { messageRequiresTools, ModelAdapter } from "./modelAdapter";
import { buildPromptDebugReport, PromptDebugReport } from "./toolPromptDebugger";
import { StructuredTool } from "@langchain/core/tools";

interface GeneratePromptDebugReportParams {
  chainManager: ChainManager;
  adapter: ModelAdapter;
  basePrompt: string;
  toolDescriptions: string;
  toolNames: string[];
  toolMetadata: ToolMetadata[];
  userMessage: ChatMessage;
}

/**
 * Build an annotated prompt debug report for the autonomous agent.
 *
 * @param params - Context required to assemble the prompt sections.
 * @returns Structured prompt report with provenance metadata.
 */
export async function generatePromptDebugReportForAgent(
  params: GeneratePromptDebugReportParams
): Promise<PromptDebugReport> {
  const {
    chainManager,
    adapter,
    basePrompt,
    toolDescriptions,
    toolNames,
    toolMetadata,
    userMessage,
  } = params;

  const systemSections = adapter.buildSystemPromptSections(
    basePrompt,
    toolDescriptions,
    toolNames,
    toolMetadata
  );

  const memory = chainManager.memoryManager.getMemory();
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = Array.isArray(memoryVariables.history) ? memoryVariables.history : [];

  const originalUserMessage = userMessage.originalMessage || userMessage.message;
  const requiresTools = messageRequiresTools(userMessage.message);
  const enhancedUserMessage = adapter.enhanceUserMessage(userMessage.message, requiresTools);

  return buildPromptDebugReport({
    systemSections,
    rawHistory,
    adapterName: adapter.constructor?.name || "ModelAdapter",
    originalUserMessage,
    enhancedUserMessage,
  });
}

/**
 * Convenience helper to compute the base prompt with memory using the provided chain manager.
 *
 * @param chainManager - Chain manager hosting the user memory manager.
 * @returns The base system prompt inclusive of memory content.
 */
export async function resolveBasePrompt(chainManager: ChainManager): Promise<string> {
  return getSystemPromptWithMemory(chainManager.userMemoryManager);
}

interface AgentPromptDebugOptions {
  chainManager: ChainManager;
  adapter: ModelAdapter;
  availableTools: StructuredTool[];
  toolDescriptions: string;
  userMessage: ChatMessage;
}

/**
 * Produce a prompt debug report directly from an agent runner context.
 *
 * @param options - Agent context, available tools, and user message.
 * @returns Annotated prompt debug report.
 */
export async function buildAgentPromptDebugReport(
  options: AgentPromptDebugOptions
): Promise<PromptDebugReport> {
  const { chainManager, adapter, availableTools, toolDescriptions, userMessage } = options;

  const registry = ToolRegistry.getInstance();
  const toolNames = availableTools.map((tool) => tool.name);
  const toolMetadata = availableTools
    .map((tool) => registry.getToolMetadata(tool.name))
    .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

  const basePrompt = await resolveBasePrompt(chainManager);

  return generatePromptDebugReportForAgent({
    chainManager,
    adapter,
    basePrompt,
    toolDescriptions,
    toolNames,
    toolMetadata,
    userMessage,
  });
}
