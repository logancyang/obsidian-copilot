import ChainFactory, {
  ChainType
} from '@/chainFactory';
import {
  AI_SENDER,
  ANTHROPIC,
  AZURE_MODELS,
  AZURE_OPENAI,
  CLAUDE_MODELS,
  COHEREAI,
  ChatModelDisplayNames,
  DEFAULT_SYSTEM_PROMPT,
  GOOGLE,
  GOOGLE_MODELS,
  HUGGINGFACE,
  LM_STUDIO,
  LM_STUDIO_MODELS,
  OLLAMA,
  OLLAMA_MODELS,
  OPENAI,
  OPENAI_MODELS,
  USER_SENDER,
} from '@/constants';
import { ChatMessage } from '@/sharedState';
import { getModelName, isSupportedChain } from '@/utils';
import VectorDBManager, { MemoryVector } from '@/vectorDBManager';
import { CohereEmbeddings } from "@langchain/cohere";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  RetrievalQAChain
} from "langchain/chains";
import { ChatAnthropic } from 'langchain/chat_models/anthropic';
import { BaseChatModel } from 'langchain/chat_models/base';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Embeddings } from "langchain/embeddings/base";
import { HuggingFaceInferenceEmbeddings } from "langchain/embeddings/hf";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { BufferWindowMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { ContextualCompressionRetriever } from "langchain/retrievers/contextual_compression";
import { LLMChainExtractor } from "langchain/retrievers/document_compressors/chain_extract";
import { AIMessage, HumanMessage, SystemMessage } from 'langchain/schema';
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Notice } from 'obsidian';
import { useState } from 'react';
import { ProxyChatOpenAI, ProxyOpenAIEmbeddings } from './langchainWrappers';


interface ModelConfig {
  modelName: string,
  temperature: number,
  streaming: boolean,
  maxRetries: number,
  maxConcurrency: number,
  maxTokens?: number,
  openAIApiKey?: string,
  anthropicApiKey?: string,
  azureOpenAIApiKey?: string,
  azureOpenAIApiInstanceName?: string,
  azureOpenAIApiDeploymentName?: string,
  azureOpenAIApiVersion?: string,
  // Google API key https://api.js.langchain.com/classes/langchain_google_genai.ChatGoogleGenerativeAI.html
  apiKey?: string,
  openAIProxyBaseUrl?: string,
  ollamaModel?: string,
  lmStudioPort?: string,
}

export interface LangChainParams {
  openAIApiKey: string,
  huggingfaceApiKey: string,
  cohereApiKey: string,
  anthropicApiKey: string,
  azureOpenAIApiKey: string,
  azureOpenAIApiInstanceName: string,
  azureOpenAIApiDeploymentName: string,
  azureOpenAIApiVersion: string,
  azureOpenAIApiEmbeddingDeploymentName: string,
  googleApiKey: string,
  model: string,
  modelDisplayName: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
  chatContextTurns: number,
  embeddingProvider: string,
  chainType: ChainType,  // Default ChainType is set in main.ts getAIStateParams
  options: SetChainOptions,
  ollamaModel: string,
  lmStudioPort: string,
  openAIProxyBaseUrl?: string,
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteContent?: string;
  forceNewCreation?: boolean;
}

/**
 * AIState manages the chat model, LangChain, and related state.
 *
 * initMemory() - Initializes the memory buffer for the chat history.
 *
 * initChatPrompt() - Initializes the chat prompt template with placeholders for chat history and user input.
 *
 * validateChainType() - Throws error if chain type is invalid.
 *
 * validateChatModel() - Returns false if chat model is empty.
 *
 * getModelConfig() - Gets model configuration based on vendor.
 *
 * buildModelMap() - Builds map of available models and required info to instantiate them.
 *
 * getEmbeddingsAPI() - Gets the appropriate embeddings API instance based on settings.
 *
 * clearChatMemory() - Clears the chat history memory.
 *
 * setChatModel() - Creates and sets the chat model instance based on name.
 *
 * setModel() - Sets new model name and display name, creates new chain.
 *
 * createChain() - Creates new chain or updates existing with new model.
 *
 * setChain() - Validates and sets the chain instance of specified type.
 *
 * buildIndex() - Builds vector index for note content using embeddings API.
 *
 * countTokens() - Counts number of tokens for given input string.
 *
 * runChatModel() - Runs chat model and handles streaming output.
 *
 * runChain() - Runs the LangChain and handles streaming output.
 */
class AIState {
  private static chatModel: BaseChatModel;
  private static chatOpenAI: ChatOpenAI;
  private static chatAnthropic: ChatAnthropic;
  private static azureChatOpenAI: ChatOpenAI;
  private static chatGoogleGenerativeAI: ChatGoogleGenerativeAI;
  private static chatOllama: ChatOllama;
  private static chain: BaseChain;
  private static retrievalChain: RetrievalQAChain;
  private static conversationalRetrievalChain: ConversationalRetrievalQAChain;

  private chatPrompt:  ChatPromptTemplate;
  private vectorStore: MemoryVectorStore;

  private static isOllamaModelActive = false;

  memory: BufferWindowMemory;
  langChainParams: LangChainParams;
  modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: new (config: ModelConfig) => BaseChatModel;
      vendor: string;
    }>;

  constructor(langChainParams: LangChainParams) {
    this.langChainParams = langChainParams;
    this.buildModelMap();
    this.initMemory();
    this.initChatPrompt();
    // This takes care of chain creation as well
    this.setModel(this.langChainParams.modelDisplayName);
  }

  private initMemory(): void {
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: 'history',
      inputKey: 'input',
      returnMessages: true,
    });
  }

  private setNoteContent(noteContent: string): void {
    this.langChainParams.options.noteContent = noteContent;
  }

  private initChatPrompt(): void {
    this.chatPrompt = ChatPromptTemplate.fromPromptMessages([
      SystemMessagePromptTemplate.fromTemplate(
        this.langChainParams.systemMessage
      ),
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null) throw new Error('No chain type set');
  }

  private validateChatModel(chatModel: BaseChatModel): boolean {
    if (chatModel === undefined || chatModel === null) {
      return false;
    }
    return true
  }

  private getModelConfig(chatModelProvider: string): ModelConfig {
    const {
      openAIApiKey,
      anthropicApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      model,
      temperature,
      maxTokens,
      openAIProxyBaseUrl,
      googleApiKey,
      ollamaModel,
    } = this.langChainParams;

    // Create a base configuration that applies to all models
    let config: ModelConfig = {
      modelName: model,
      temperature: temperature,
      streaming: true,
      maxRetries: 3,
      maxConcurrency: 3,
    };

    switch(chatModelProvider) {
      case OPENAI:
        config = {
          ...config,
          openAIApiKey,
          maxTokens,
          openAIProxyBaseUrl,
        };
        break;
      case ANTHROPIC:
        config = {
          ...config,
          anthropicApiKey,
        };
        break;
      case AZURE_OPENAI:
        config = {
          ...config,
          maxTokens,
          azureOpenAIApiKey: azureOpenAIApiKey,
          azureOpenAIApiInstanceName: azureOpenAIApiInstanceName,
          azureOpenAIApiDeploymentName: azureOpenAIApiDeploymentName,
          azureOpenAIApiVersion: azureOpenAIApiVersion,
        };
        break;
      case GOOGLE:
        config = {
          ...config,
          apiKey: googleApiKey,
        };
        break;
      case LM_STUDIO:
        config = {
          ...config,
          openAIApiKey: 'placeholder',
          openAIProxyBaseUrl: `http://localhost:${this.langChainParams.lmStudioPort}/v1`,
        };
        break;
      case OLLAMA:
        config = {
          ...config,
          modelName: ollamaModel,
        };
        break;
    }

    return config;
  }

  private buildModelMap() {
    const modelMap: Record<
      string,
      {
        hasApiKey: boolean;
        AIConstructor: new (config: ModelConfig) => BaseChatModel;
        vendor: string;
      }
    > = {};

    const OpenAIChatModel = this.langChainParams.openAIProxyBaseUrl
      ? ProxyChatOpenAI : ChatOpenAI;

    // Build modelMap
    for (const modelDisplayNameKey of OPENAI_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: Boolean(this.langChainParams.openAIApiKey),
        AIConstructor: OpenAIChatModel,
        vendor: OPENAI,
      };
    }

    for (const modelDisplayNameKey of CLAUDE_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: Boolean(this.langChainParams.anthropicApiKey),
        AIConstructor: ChatAnthropic,
        vendor: ANTHROPIC,
      };
    }

    for (const modelDisplayNameKey of AZURE_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: Boolean(this.langChainParams.azureOpenAIApiKey),
        AIConstructor: ChatOpenAI,
        vendor: AZURE_OPENAI,
      };
    }

    for (const modelDisplayNameKey of GOOGLE_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: Boolean(this.langChainParams.googleApiKey),
        AIConstructor: ChatGoogleGenerativeAI,
        vendor: GOOGLE,
      };
    }

    for (const modelDisplayNameKey of OLLAMA_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: true,
        AIConstructor: ChatOllama,
        vendor: OLLAMA,
      };
    }

    for (const modelDisplayNameKey of LM_STUDIO_MODELS) {
      modelMap[modelDisplayNameKey] = {
        hasApiKey: true,
        AIConstructor: ProxyChatOpenAI,
        vendor: LM_STUDIO,
      };
    }

    this.modelMap = modelMap;
  }

  getEmbeddingsAPI(): Embeddings {
    const {
      openAIApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      openAIProxyBaseUrl,
    } = this.langChainParams;

    // Note that openAIProxyBaseUrl has the highest priority.
    // If openAIProxyBaseUrl is set, it overrides both chat and embedding models.
    const OpenAIEmbeddingsAPI = openAIProxyBaseUrl ?
      new ProxyOpenAIEmbeddings({
        openAIApiKey,
        maxRetries: 3,
        maxConcurrency: 3,
        timeout: 10000,
        openAIProxyBaseUrl,
      }):
      new OpenAIEmbeddings({
        openAIApiKey,
        maxRetries: 3,
        maxConcurrency: 3,
        timeout: 10000,
      });

    switch(this.langChainParams.embeddingProvider) {
      case OPENAI:
        // Every OpenAIEmbedding call is giving a 'refused to set header user-agent'
        // It's generally not a problem.
        // TODO: Check if this error can be avoided.
        return OpenAIEmbeddingsAPI
      case HUGGINGFACE:
        // TODO: This does not have a timeout param, need to check in the future.
        return new HuggingFaceInferenceEmbeddings({
          apiKey: this.langChainParams.huggingfaceApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case COHEREAI:
        return new CohereEmbeddings({
          apiKey: this.langChainParams.cohereApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case AZURE_OPENAI:
        return new OpenAIEmbeddings({
          azureOpenAIApiKey,
          azureOpenAIApiInstanceName,
          azureOpenAIApiDeploymentName: azureOpenAIApiEmbeddingDeploymentName,
          azureOpenAIApiVersion,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      // TODO: Check Ollama local embedding and come back here
      // case OLLAMA:
      //   return new ProxyOpenAIEmbeddings({
      //     openAIApiKey,
      //     openAIProxyBaseUrl,
      //     maxRetries: 3,
      //     maxConcurrency: 3,
      //     timeout: 10000,
      //   })
      default:
        console.error('No embedding provider set. Using OpenAI.');
        return OpenAIEmbeddingsAPI;
    }
  }

  clearChatMemory(): void {
    console.log('clearing chat memory');
    this.memory.clear();
  }

  private setChatModel(modelDisplayName: string): void {
    if (!this.modelMap.hasOwnProperty(modelDisplayName)) {
      throw new Error(`No model found for: ${modelDisplayName}`);
    }

    // Create and return the appropriate model
    const selectedModel = this.modelMap[modelDisplayName];
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelDisplayName}. Model switch failed.`;
      new Notice(errorMessage);
      // Stop execution and deliberate fail the model switch
      throw new Error(errorMessage);
    }

    const modelConfig = this.getModelConfig(selectedModel.vendor);

    try {
      const newModelInstance = new selectedModel.AIConstructor({
        ...modelConfig,
      });

      switch(selectedModel.vendor) {
        case OPENAI:
          AIState.chatOpenAI = newModelInstance as ChatOpenAI;
          break;
        case ANTHROPIC:
          AIState.chatAnthropic = newModelInstance as ChatAnthropic;
          break;
        case AZURE_OPENAI:
          AIState.azureChatOpenAI = newModelInstance as ChatOpenAI;
          break;
        case GOOGLE:
          AIState.chatGoogleGenerativeAI = newModelInstance as ChatGoogleGenerativeAI;
          break;
        case OLLAMA:
          AIState.chatOllama = newModelInstance as ChatOllama;
          break;
      }

      AIState.chatModel = newModelInstance;
    } catch (error) {
      console.error(error);
      new Notice(`Error creating model: ${modelDisplayName}`);
    }
  }

  setModel(newModelDisplayName: string): void {
    AIState.isOllamaModelActive = newModelDisplayName === ChatModelDisplayNames.OLLAMA;
    // model and model display name must be update at the same time!
    let newModel = getModelName(newModelDisplayName);

    if (newModelDisplayName === ChatModelDisplayNames.OLLAMA) {
      newModel = this.langChainParams.ollamaModel;
    }

    if (newModelDisplayName === ChatModelDisplayNames.LM_STUDIO) {
      newModel = 'check_model_in_lm_studio_ui';
    }

    try {
      this.langChainParams.model = newModel;
      this.langChainParams.modelDisplayName = newModelDisplayName;
      this.setChatModel(newModelDisplayName);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.createChain(
        this.langChainParams.chainType,
        {...this.langChainParams.options, forceNewCreation: true},
      )
      console.log(`Setting model to ${newModelDisplayName}: ${newModel}`);
    } catch (error) {
      console.error("setModel failed: ", error);
      console.log("model:", this.langChainParams.model);
    }
  }

  /* Create a new chain, or update chain with new model */
  createChain(
    chainType: ChainType,
    options?: SetChainOptions,
  ): void {
    this.validateChainType(chainType);
    try {
      this.setChain(chainType, options);
    } catch (error) {
      new Notice('Error creating chain:', error);
      console.error('Error creating chain:', error);
    }
  }

  async setChain(
    chainType: ChainType,
    options: SetChainOptions = {},
  ): Promise<void> {
    if (!this.validateChatModel(AIState.chatModel)) {
      // No need to throw error and trigger multiple Notices to user
      console.error('setChain failed: No chat model set.');
      return;
    }
    this.validateChainType(chainType);

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        // For initial load of the plugin
        if (options.forceNewCreation) {
          // setChain is async, this is to ensure Ollama has the right model passed in from the setting
          if (AIState.isOllamaModelActive) {
            (AIState.chatModel as ChatOllama).model = this.langChainParams.ollamaModel;
          }

          AIState.chain = ChainFactory.createNewLLMChain({
            llm: AIState.chatModel,
            memory: this.memory,
            prompt: options.prompt || this.chatPrompt,
          }) as ConversationChain;
        } else {
          // For navigating back to the plugin view
          AIState.chain = ChainFactory.getLLMChainFromMap({
            llm: AIState.chatModel,
            memory: this.memory,
            prompt: options.prompt || this.chatPrompt,
          }) as ConversationChain;
        }

        this.langChainParams.chainType = ChainType.LLM_CHAIN;
        console.log('Set chain:', ChainType.LLM_CHAIN);
        break;
      }
      case ChainType.RETRIEVAL_QA_CHAIN: {
        if (!options.noteContent) {
          new Notice('No note content provided');
          throw new Error('No note content provided');
        }

        this.setNoteContent(options.noteContent);
        const docHash = VectorDBManager.getDocumentHash(options.noteContent);
        const parsedMemoryVectors: MemoryVector[] | undefined = await VectorDBManager.getMemoryVectors(docHash);
        if (parsedMemoryVectors) {
          const vectorStore = await VectorDBManager.rebuildMemoryVectorStore(
            parsedMemoryVectors, this.getEmbeddingsAPI()
          );
          AIState.retrievalChain = RetrievalQAChain.fromLLM(
            AIState.chatModel,
            vectorStore.asRetriever(),
          );
          console.log('Existing vector store for document hash: ', docHash);
        } else {
          await this.buildIndex(options.noteContent, docHash);
          if (!this.vectorStore) {
            console.error('Error creating vector store.');
            return;
          }

          const baseCompressor = LLMChainExtractor.fromLLM(AIState.chatModel);
          const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: this.vectorStore.asRetriever(),
          });
          AIState.retrievalChain = RetrievalQAChain.fromLLM(
            AIState.chatModel,
            retriever,
          );
          console.log(
            'New retrieval qa chain with contextual compression created for '
            + 'document hash: ', docHash
          );
        }

        this.langChainParams.chainType = ChainType.RETRIEVAL_QA_CHAIN;
        console.log('Set chain:', ChainType.RETRIEVAL_QA_CHAIN);
        break;
      }
      default:
        this.validateChainType(chainType);
        break;
    }
  }

  async buildIndex(noteContent: string, docHash: string): Promise<void> {
    const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

    const docs = await textSplitter.createDocuments([noteContent]);
    const embeddingsAPI = this.getEmbeddingsAPI();

    // Note: HF can give 503 errors frequently (it's free)
    console.log('Creating vector store...');
    try {
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        docs, embeddingsAPI,
      );
      // Serialize and save vector store to PouchDB
      VectorDBManager.setMemoryVectors(this.vectorStore.memoryVectors, docHash);
      console.log('Vector store created successfully.');
      new Notice('Vector store created successfully.');
    } catch (error) {
      new Notice('Failed to create vector store, please try again:', error);
      console.error('Failed to create vector store, please try again.:', error);
    }
  }

  async countTokens(inputStr: string): Promise<number> {
    return AIState.chatOpenAI.getNumTokens(inputStr);
  }

  async runChatModel(
    userMessage: ChatMessage,
    chatContext: ChatMessage[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    debug = false,
  ) {
    if (debug) {
      console.log('chatModel:', AIState.chatModel);
      for (const [i, chatMessage] of chatContext.entries()) {
        console.log(
          `chat message ${i}:\nsender: ${chatMessage.sender}\n${chatMessage.message}`
        );
      }
    }

    const systemMessage = this.langChainParams.systemMessage || DEFAULT_SYSTEM_PROMPT;
    const messages = [
      new SystemMessage(systemMessage),
      ...chatContext.map((chatMessage) => {
        return chatMessage.sender === USER_SENDER
          ? new HumanMessage(chatMessage.message)
          : new AIMessage(chatMessage.message);
      }),
      new HumanMessage(userMessage.message),
    ];

    let fullAIResponse = '';
    await AIState.chatModel.call(
      messages,
      { signal: abortController.signal },
      [
        {
          handleLLMNewToken: (token) => {
            fullAIResponse += token;
            updateCurrentAiMessage(fullAIResponse);
          }
        }
      ]
    );

    addMessage({
      message: fullAIResponse,
      sender: AI_SENDER,
      isVisible: true,
    });
    updateCurrentAiMessage('');
    return fullAIResponse;
  }

  async runChain(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    debug = false,
  ) {
    if (!this.validateChatModel(AIState.chatModel)) {
      const errorMsg = 'Chat model is not initialized properly, check your API key in Copilot setting and make sure you have API access.';
      new Notice(errorMsg);
      console.error(errorMsg);
      return;
    }
    // Check if chain is initialized properly
    if (!AIState.chain || !isSupportedChain(AIState.chain)) {
      console.error(
        'Chain is not initialized properly, re-initializing chain: ',
        this.langChainParams.chainType
      );
      this.setChain(this.langChainParams.chainType, this.langChainParams.options);
    }

    const {
      temperature,
      maxTokens,
      systemMessage,
      chatContextTurns,
      chainType,
    } = this.langChainParams;

    let fullAIResponse = '';
    const chain = AIState.chain as any;
    try {
      switch(chainType) {
        case ChainType.LLM_CHAIN:
          if (debug) {
            console.log(`*** DEBUG INFO ***\n`
              + `user message: ${userMessage}\n`
              // ChatOpenAI has modelName, some other ChatModels like ChatOllama have model
              + `model: ${chain.llm.modelName || chain.llm.model}\n`
              + `chain type: ${chainType}\n`
              + `temperature: ${temperature}\n`
              + `maxTokens: ${maxTokens}\n`
              + `system message: ${systemMessage}\n`
              + `chat context turns: ${chatContextTurns}\n`,
            );
            console.log('chain:', chain);
            console.log('Chat memory:', this.memory);
          }
          await AIState.chain.call(
            {
              input: userMessage,
              signal: abortController.signal,
            },
            [
              {
                handleLLMNewToken: (token) => {
                  fullAIResponse += token;
                  updateCurrentAiMessage(fullAIResponse);
                }
              }
            ]
          );
          break;
        case ChainType.RETRIEVAL_QA_CHAIN:
          if (debug) {
            console.log(`*** DEBUG INFO ***\n`
              + `user message: ${userMessage}\n`
              + `model: ${chain.llm.modelName}\n`
              + `chain type: ${chainType}\n`
              + `temperature: ${temperature}\n`
              + `maxTokens: ${maxTokens}\n`
              + `system message: ${systemMessage}\n`
              + `chat context turns: ${chatContextTurns}\n`,
            );
            console.log('chain:', chain);
            console.log('embedding provider:', this.langChainParams.embeddingProvider);
          }
          await AIState.retrievalChain.call(
            {
              query: userMessage,
              signal: abortController.signal,
            },
            [
              {
                handleLLMNewToken: (token) => {
                  fullAIResponse += token;
                  updateCurrentAiMessage(fullAIResponse);
                }
              }
            ]
          );
          break;
        default:
          console.error('Chain type not supported:', this.langChainParams.chainType);
      }
    } catch (error) {
      const errorData = error?.response?.data?.error || error;
      const errorCode = errorData?.code || error;
      if (errorCode === 'model_not_found') {
        const modelNotFoundMsg = "You do not have access to this model or the model does not exist, please check with your API provider.";
        new Notice(modelNotFoundMsg);
        console.error(modelNotFoundMsg);
      } else {
        new Notice(`LangChain error: ${errorCode}`);
        console.error(errorData);
      }
    } finally {
      if (fullAIResponse) {
        addMessage({
          message: fullAIResponse,
          sender: AI_SENDER,
          isVisible: true,
        });
      }
      updateCurrentAiMessage('');
    }
    return fullAIResponse;
  }
}

/**
 * React hook to manage state related to model, chain and memory in Chat component.
*/
export function useAIState(
  aiState: AIState,
): [
  string,
  (model: string) => void,
  ChainType,
  (chain: ChainType, options?: SetChainOptions) => void,
  () => void,
] {
  const { langChainParams } = aiState;
  const [currentModel, setCurrentModel] = useState<string>(langChainParams.modelDisplayName);
  const [currentChain, setCurrentChain] = useState<ChainType>(langChainParams.chainType);
  const [, setChatMemory] = useState<BufferWindowMemory | null>(aiState.memory);

  const clearChatMemory = () => {
    aiState.clearChatMemory();
    setChatMemory(aiState.memory);
  };

  const setModel = (newModelDisplayName: string) => {
    aiState.setModel(newModelDisplayName);
    setCurrentModel(newModelDisplayName);
  };

  const setChain = (newChain: ChainType, options?: SetChainOptions) => {
    aiState.setChain(newChain, options);
    setCurrentChain(newChain);
  };

  return [
    currentModel,
    setModel,
    currentChain,
    setChain,
    clearChatMemory,
  ];
}

export default AIState;
