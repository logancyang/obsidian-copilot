import { ABORT_REASON, AI_SENDER, LOADING_MESSAGES } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { ToolManager } from "@/tools/toolManager";
import { extractChatHistory, extractUniqueTitlesFromDocs, formatDateTime } from "@/utils";
import { Notice } from "obsidian";
import ChainManager from "./chainManager";
import { IntentAnalyzer } from "./intentAnalyzer";

export interface ChainRunner {
  run(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;
}

abstract class BaseChainRunner implements ChainRunner {
  constructor(protected chainManager: ChainManager) {}

  abstract run(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;

  protected async handleResponse(
    fullAIResponse: string,
    userMessage: string,
    abortController: AbortController,
    addMessage: (message: ChatMessage) => void,
    updateCurrentAiMessage: (message: string) => void,
    debug: boolean,
    sources?: { title: string; score: number }[]
  ) {
    if (debug) console.log("==== Final AI Response ====\n", fullAIResponse);
    if (fullAIResponse && abortController.signal.reason !== ABORT_REASON.NEW_CHAT) {
      await this.chainManager.memoryManager
        .getMemory()
        .saveContext({ input: userMessage }, { output: fullAIResponse });
      addMessage({
        message: fullAIResponse,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
        sources: sources,
      });
    }
    updateCurrentAiMessage("");
    return fullAIResponse;
  }

  protected async handleError(error: any, debug: boolean) {
    if (debug) console.error("Error during LLM invocation:", error);
    const errorData = error?.response?.data?.error || error;
    const errorCode = errorData?.code || error;
    if (errorCode === "model_not_found") {
      const modelNotFoundMsg =
        "You do not have access to this model or the model does not exist, please check with your API provider.";
      new Notice(modelNotFoundMsg);
      console.error(modelNotFoundMsg);
    } else {
      new Notice(`LangChain error: ${errorCode}`);
      console.error(errorData);
    }
  }
}

class LLMChainRunner extends BaseChainRunner {
  async run(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string> {
    const { debug = false } = options;
    let fullAIResponse = "";

    try {
      const chain = ChainManager.getChain();
      const chatStream = await chain.stream({
        input: userMessage,
      } as any);

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        fullAIResponse += chunk.content;
        updateCurrentAiMessage(fullAIResponse);
      }
    } catch (error) {
      await this.handleError(error, debug);
    }

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug
    );
  }
}

class VaultQAChainRunner extends BaseChainRunner {
  async run(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string> {
    const { debug = false } = options;
    let fullAIResponse = "";

    try {
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);
      const qaStream = await ChainManager.getRetrievalChain().stream({
        question: userMessage,
        chat_history: chatHistory,
      } as any);

      for await (const chunk of qaStream) {
        if (abortController.signal.aborted) break;
        fullAIResponse += chunk.content;
        updateCurrentAiMessage(fullAIResponse);
      }

      fullAIResponse = this.addSourcestoResponse(fullAIResponse);
    } catch (error) {
      await this.handleError(error, debug);
    }

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug
    );
  }

  private addSourcestoResponse(response: string): string {
    const docTitles = extractUniqueTitlesFromDocs(ChainManager.retrievedDocuments);
    if (docTitles.length > 0) {
      const markdownLinks = docTitles
        .map(
          (title) =>
            `- [${title}](obsidian://open?vault=${encodeURIComponent(this.chainManager.app.vault.getName())}&file=${encodeURIComponent(
              title
            )})`
        )
        .join("\n");
      response += "\n\n#### Sources:\n" + markdownLinks;
    }
    return response;
  }
}

class CopilotPlusChainRunner extends BaseChainRunner {
  async run(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
      updateLoadingMessage?: (message: string) => void;
    }
  ): Promise<string> {
    const { debug = false, updateLoadingMessage } = options;
    let fullAIResponse = "";
    let sources: { title: string; score: number }[] = [];

    try {
      if (debug) console.log("==== Step 1: Analyzing intent ====");
      const toolCalls = await IntentAnalyzer.analyzeIntent(
        userMessage,
        this.chainManager.vectorStoreManager,
        this.chainManager.chatModelManager
      );
      if (debug)
        console.log(
          "Tool identification result:",
          toolCalls.map((call) => call.tool.name)
        );

      // TODO: Remove all @tools from the user message
      const cleanedUserMessage = userMessage.replace("@vault", "").trim();

      const toolOutputs = await this.executeToolCalls(toolCalls, debug, updateLoadingMessage);
      const localSearchResult = toolOutputs.find(
        (output) => output.tool === "localSearch" && output.output && output.output.length > 0
      );

      if (localSearchResult) {
        if (debug) console.log("==== Step 2: Processing local search results ====");
        const documents = JSON.parse(localSearchResult.output);

        // Format chat history from memory
        const memory = this.chainManager.memoryManager.getMemory();
        const memoryVariables = await memory.loadMemoryVariables({});
        const chatHistory = extractChatHistory(memoryVariables);

        if (debug) console.log("==== Step 3: Condensing Question ====");
        const standaloneQuestion = await this.getStandaloneQuestion(
          cleanedUserMessage,
          chatHistory
        );
        if (debug) console.log("Condensed standalone question: ", standaloneQuestion);

        if (debug) console.log("==== Step 4: Preparing context ====");
        const timeExpression = this.getTimeExpression(toolCalls);
        const context = this.formatLocalSearchResult(documents, timeExpression);

        if (debug) console.log(context);
        if (debug) console.log("==== Step 5: Invoking QA Chain ====");
        const qaPrompt = await this.chainManager.promptManager.getQAPrompt({
          question: standaloneQuestion,
          context: context,
          systemMessage: this.chainManager.getLangChainParams().systemMessage,
        });

        const chatStream = await this.chainManager.chatModelManager.getChatModel().stream(qaPrompt);

        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) break;
          fullAIResponse += chunk.content;
          updateCurrentAiMessage(fullAIResponse);
        }

        // Append sources to the response
        sources = this.getSources(documents);
      } else {
        const enhancedUserMessage = this.prepareEnhancedUserMessage(
          cleanedUserMessage,
          toolOutputs
        );
        // If no results, default to LLM Chain
        if (debug) {
          console.log("No local search results. Using standard LLM Chain.");
          console.log("Enhanced user message:", enhancedUserMessage);
        }

        const chatStream = await ChainManager.getChain().stream({
          input: enhancedUserMessage,
        } as any);

        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) break;
          fullAIResponse += chunk.content;
          updateCurrentAiMessage(fullAIResponse);
        }
      }
    } catch (error) {
      // Reset loading message to default
      updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);
      await this.handleError(error, debug);
    }

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug,
      sources
    );
  }

  private async getStandaloneQuestion(
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

    const response = await this.chainManager.chatModelManager.getChatModel().invoke([
      { role: "system", content: condenseQuestionTemplate },
      {
        role: "user",
        content: condenseQuestionTemplate
          .replace("{chat_history}", formattedChatHistory)
          .replace("{question}", question),
      },
    ]);

    return response.content as string;
  }

  private getSources(documents: any): { title: string; score: number }[] {
    return this.sortUniqueDocsByScore(documents);
  }

  private sortUniqueDocsByScore(documents: any[]): any[] {
    // Create a map to store the highest-scoring document for each title
    const uniqueDocs = new Map<string, any>();

    // Iterate through all documents
    for (const doc of documents) {
      const currentDoc = uniqueDocs.get(doc.title);

      // If the title doesn't exist in the map, or if the new doc has a higher score, update the map
      if (!currentDoc || doc.score > currentDoc.score) {
        uniqueDocs.set(doc.title, doc);
      }
    }

    // Convert the map values back to an array and sort by score in descending order
    return Array.from(uniqueDocs.values()).sort((a, b) => b.score - a.score);
  }

  private async executeToolCalls(
    toolCalls: any[],
    debug: boolean,
    updateLoadingMessage?: (message: string) => void
  ) {
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
      if (debug) {
        console.log(`==== Step 2: Calling tool: ${toolCall.tool.name} ====`);
      }
      if (toolCall.tool.name === "localSearch") {
        updateLoadingMessage?.(LOADING_MESSAGES.READING_FILES);
      }
      const output = await ToolManager.callTool(toolCall.tool, toolCall.args);
      toolOutputs.push({ tool: toolCall.tool.name, output });
    }
    return toolOutputs;
  }

  private prepareEnhancedUserMessage(userMessage: string, toolOutputs: any[]) {
    let context = "";
    if (toolOutputs.length > 0) {
      context =
        "Additional context:\n\n" +
        toolOutputs
          .map((output) => `# ${output.tool}\n${JSON.stringify(output.output)}`)
          .join("\n\n");
    }
    return `User message: ${userMessage}\n${context}`;
  }

  private getTimeExpression(toolCalls: any[]): string {
    const timeRangeCall = toolCalls.find((call) => call.tool.name === "getTimeRangeMs");
    return timeRangeCall ? timeRangeCall.args.timeExpression : "recent";
  }

  private formatLocalSearchResult(documents: any[], timeExpression: string): string {
    const formattedDocs = documents
      .filter((doc) => doc.includeInContext)
      .map((doc: any) => `Note in Vault: ${doc.content}`)
      .join("\n\n");
    return `Local Search Result for ${timeExpression}:\n${formattedDocs}`;
  }
}

export { CopilotPlusChainRunner, LLMChainRunner, VaultQAChainRunner };
