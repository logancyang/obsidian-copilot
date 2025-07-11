import ProjectManager from "@/LLMProviders/projectManager";
import { ChatHistoryEntry, removeThinkTags, withSuppressedTokenWarnings } from "@/utils";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";

export async function getStandaloneQuestion(
  question: string,
  chatHistory: ChatHistoryEntry[]
): Promise<string> {
  const condenseQuestionTemplate = `Given the following conversation and a follow up question,
    summarize the conversation as context and keep the follow up question unchanged, in its original language.
    If the follow up question is unrelated to its preceding messages, return this follow up question directly.
    If it is related, then combine the summary and the follow up question to construct a standalone question.
    Make sure to keep any [[]] wrapped note titles in the question unchanged.
    If there's nothing in the chat history, just return the follow up question.

    Chat History:
    {chat_history}
    Follow Up Input: {question}
    Standalone question:`;

  const formattedChatHistory = chatHistory
    .map(({ role, content }) => `${role}: ${content}`)
    .join("\n");

  // Wrap the model call with token warning suppression
  return await withSuppressedTokenWarnings(async () => {
    const chatModel = ProjectManager.instance
      .getCurrentChainManager()
      .chatModelManager.getChatModel()
      .bind({ temperature: 0 } as BaseChatModelCallOptions);
    const response = await chatModel.invoke([
      {
        role: "user",
        content: condenseQuestionTemplate
          .replace("{chat_history}", formattedChatHistory)
          .replace("{question}", question),
      },
    ]);

    return removeThinkTags(response.content as string);
  });
}
