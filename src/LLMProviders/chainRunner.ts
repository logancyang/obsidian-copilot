import { ABORT_REASON, AI_SENDER, LOADING_MESSAGES } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { ToolManager } from "@/tools/toolManager";
import { extractChatHistory, extractUniqueTitlesFromDocs, formatDateTime } from "@/utils";
import { Notice } from "obsidian";
import ChainManager from "./chainManager";
import { IntentAnalyzer } from "./intentAnalyzer";

export interface ChainRunner {
  run(
    userMessage: ChatMessage,
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
    userMessage: ChatMessage,
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
    userMessage: ChatMessage,
    abortController: AbortController,
    addMessage: (message: ChatMessage) => void,
    updateCurrentAiMessage: (message: string) => void,
    debug: boolean,
    sources?: { title: string; score: number }[]
  ) {
    if (fullAIResponse && abortController.signal.reason !== ABORT_REASON.NEW_CHAT) {
      await this.chainManager.memoryManager
        .getMemory()
        .saveContext({ input: userMessage.message }, { output: fullAIResponse });

      addMessage({
        message: fullAIResponse,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
        sources: sources,
      });
    }
    updateCurrentAiMessage("");
    if (debug) {
      console.log(
        "==== Chat Memory ====\n",
        (this.chainManager.memoryManager.getMemory().chatHistory as any).messages.map(
          (m: any) => m.content
        )
      );
      console.log("==== Final AI Response ====\n", fullAIResponse);
    }
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
    userMessage: ChatMessage,
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
        input: userMessage.message,
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
    userMessage: ChatMessage,
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
        question: userMessage.message,
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
  private async streamMultimodalResponse(
    textContent: string,
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    debug: boolean
  ): Promise<string> {
    // Get chat history
    const memory = this.chainManager.memoryManager.getMemory();
    const memoryVariables = await memory.loadMemoryVariables({});
    const chatHistory = extractChatHistory(memoryVariables);

    // Create messages array starting with system message
    const messages: any[] = [];

    // Add system message if available
    const systemMessage = this.chainManager.getLangChainParams().systemMessage;
    if (systemMessage) {
      messages.push({
        role: "system",
        content: `${systemMessage}\nIMPORTANT: Maintain consistency with previous responses in the conversation. If you've provided information about a person or topic before, use that same information in follow-up questions.`,
      });
    }

    // Add chat history with explicit instruction to maintain context
    if (chatHistory.length > 0) {
      messages.push({
        role: "system",
        content:
          "The following is the relevant conversation history. Use this context to maintain consistency in your responses:",
      });
    }

    // Add chat history
    for (const [human, ai] of chatHistory) {
      messages.push({ role: "user", content: human });
      messages.push({ role: "assistant", content: ai });
    }

    // Create content array for current message
    const content = [
      {
        type: "text",
        text: textContent,
      },
    ];

    // Add image content if present
    if (userMessage.content && userMessage.content.length > 0) {
      const imageContent = userMessage.content.filter(
        (item) => item.type === "image_url" && item.image_url?.url
      );
      content.push(...imageContent);
    }

    // Add current user message
    messages.push({
      role: "user",
      content,
    });

    let fullAIResponse = "";
    const chatStream = await this.chainManager.chatModelManager.getChatModel().stream(messages);

    for await (const chunk of chatStream) {
      if (abortController.signal.aborted) break;
      fullAIResponse += chunk.content;
      updateCurrentAiMessage(fullAIResponse);
    }

    return fullAIResponse;
  }

  async run(
    userMessage: ChatMessage,
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
        userMessage.message,
        this.chainManager.vectorStoreManager,
        this.chainManager.chatModelManager,
        this.chainManager.brevilabsClient
      );
      if (debug)
        console.log(
          "Tool identification result:",
          toolCalls.map((call) => call.tool.name)
        );

      const cleanedUserMessage = userMessage.message.replace("@vault", "").trim();
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

        fullAIResponse = await this.streamMultimodalResponse(
          qaPrompt,
          userMessage,
          abortController,
          updateCurrentAiMessage,
          debug
        );

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

        fullAIResponse = await this.streamMultimodalResponse(
          enhancedUserMessage,
          userMessage,
          abortController,
          updateCurrentAiMessage,
          debug
        );
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
    if (!documents || !Array.isArray(documents)) {
      console.warn("No valid documents provided to getSources");
      return [];
    }
    return this.sortUniqueDocsByScore(documents);
  }

  private sortUniqueDocsByScore(documents: any[]): any[] {
    const uniqueDocs = new Map<string, any>();

    // Iterate through all documents
    for (const doc of documents) {
      if (!doc.title || (!doc?.score && !doc?.rerank_score)) {
        console.warn("Invalid document structure:", doc);
        continue;
      }

      const currentDoc = uniqueDocs.get(doc.title);
      const isReranked = doc && "rerank_score" in doc;
      const docScore = isReranked ? doc.rerank_score : doc.score;

      // If the title doesn't exist in the map, or if the new doc has a higher score, update the map
      if (!currentDoc || docScore > (currentDoc.score ?? 0)) {
        uniqueDocs.set(doc.title, {
          title: doc.title,
          score: docScore,
          isReranked: isReranked,
        });
      }
    }

    // Convert the map values back to an array and sort by score in descending order
    return Array.from(uniqueDocs.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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
    return timeRangeCall ? timeRangeCall.args.timeExpression : "";
  }

  private formatLocalSearchResult(documents: any[], timeExpression: string): string {
    const formattedDocs = documents
      .filter((doc) => doc.includeInContext)
      .map((doc: any) => `Note in Vault: ${doc.content}`)
      .join("\n\n");
    return timeExpression
      ? `Local Search Result for ${timeExpression}:\n${formattedDocs}`
      : `Local Search Result:\n${formattedDocs}`;
  }
}

export { CopilotPlusChainRunner, LLMChainRunner, VaultQAChainRunner };
