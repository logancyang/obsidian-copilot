import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { RunnableSequence } from "@langchain/core/runnables";

export async function streamLangChain(
  input: string,
  chain: RunnableSequence,
  abortController: AbortController,
  updateCurrentAiMessage: (message: string) => void
): Promise<string> {
  let fullAIResponse = "";

  try {
    const chatModel = chain.steps.find((step) => step instanceof BaseChatModel) as BaseChatModel;
    const isO1PreviewModel = chatModel.modelName === "o1-preview";

    if (!isO1PreviewModel) {
      const chatStream = await chain.stream({
        input,
      } as any);

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        fullAIResponse += chunk.content;
        updateCurrentAiMessage(fullAIResponse);
      }
    } else {
      // For o1-preview model, do not use streaming
      const result = await chain.invoke({
        input,
      } as any);
      fullAIResponse = result.response;
      updateCurrentAiMessage(fullAIResponse);
    }
  } catch (error) {
    console.error("Error streaming response:", error);
    throw error;
  }

  return fullAIResponse;
}

export async function streamMultimodal(
  messages: any,
  chatModel: BaseChatModel,
  abortController: AbortController,
  updateCurrentAiMessage: (message: string) => void
): Promise<string> {
  let fullAIResponse = "";

  try {
    const isO1PreviewModel = chatModel.modelName === "o1-preview";

    if (!isO1PreviewModel) {
      const chatStream = await chatModel.stream(messages);

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        fullAIResponse += chunk.content;
        updateCurrentAiMessage(fullAIResponse);
      }
    } else {
      // For o1-preview model, do not use streaming
      const result = await chatModel.invoke(messages);
      fullAIResponse = result.content;
      updateCurrentAiMessage(fullAIResponse);
    }
  } catch (error) {
    console.error("Error streaming multimodal response:", error);
    throw error;
  }

  return fullAIResponse;
}
