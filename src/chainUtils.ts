import ChatModelManager from "@/LLMProviders/chatModelManager";

export async function getStandaloneQuestion(
  question: string,
  chatHistory: [string, string][]
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
    .map(([human, ai]) => `Human: ${human}\nAssistant: ${ai}`)
    .join("\n");

  const response = await ChatModelManager.getInstance()
    .getChatModel()
    .invoke([
      {
        role: "user",
        content: condenseQuestionTemplate
          .replace("{chat_history}", formattedChatHistory)
          .replace("{question}", question),
      },
    ]);

  return response.content as string;
}
