/**
 * Custom Command Chat Engine - shared streaming chat logic.
 * Extracted from CustomCommandChatModal.tsx for reuse across Quick Ask and Custom Commands.
 */

import { RunnableSequence } from "@langchain/core/runnables";
import { BaseChatMemory, BufferMemory } from "@langchain/classic/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CustomModel } from "@/aiParams";

/**
 * Creates a new BufferMemory instance for chat history.
 */
export function createChatMemory(): BufferMemory {
  return new BufferMemory({
    returnMessages: true,
    memoryKey: "history",
  });
}

/**
 * Creates a chat chain with the specified model and system prompt.
 *
 * @param selectedModel - The model configuration to use
 * @param systemPrompt - The system prompt for the conversation
 * @param memory - The memory instance for conversation history
 * @returns A configured RunnableSequence for chat
 */
export async function createChatChain(
  selectedModel: CustomModel,
  systemPrompt: string,
  memory: BaseChatMemory
): Promise<RunnableSequence> {
  const chatModel = await ChatModelManager.getInstance().createModelInstance(selectedModel);

  const defaultSystemPrompt =
    "You are a helpful assistant. You'll help the user with their content editing needs.";

  const chatPrompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(systemPrompt || defaultSystemPrompt),
    new MessagesPlaceholder("history"),
    HumanMessagePromptTemplate.fromTemplate("{input}"),
  ]);

  return RunnableSequence.from([
    {
      input: (initialInput) => initialInput.input,
      memory: () => memory.loadMemoryVariables({}),
    },
    {
      input: (previousOutput) => previousOutput.input,
      history: (previousOutput) => previousOutput.memory.history,
    },
    chatPrompt,
    chatModel,
  ]);
}
