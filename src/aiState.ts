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
  HUGGINGFACE,
  LOCALAI,
  OPENAI,
  OPENAI_MODELS,
  USER_SENDER,
} from '@/constants';
import { ChatMessage } from '@/sharedState';
import { getModelName, isSupportedChain } from '@/utils';
import VectorDBManager, { MemoryVector } from '@/vectorDBManager';
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
import { CohereEmbeddings } from "langchain/embeddings/cohere";
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
  openAIProxyBaseUrl?: string,
  localAIModel?: string,
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
  model: string,
  modelDisplayName: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
  chatContextTurns: number,
  embeddingProvider: string,
  chainType: ChainType,  // Default ChainType is set in main.ts getAIStateParams
  options: SetChainOptions,
  openAIProxyBaseUrl?: string,
  localAIModel?: string,
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteContent?: string;
  forceNewCreation?: boolean;
}

class AIState {
  private static chatModel: BaseChatModel;
  private static chatOpenAI: ChatOpenAI;
  private static chatAnthropic: ChatAnthropic;
  private static azureChatOpenAI: ChatOpenAI;
  private static chain: BaseChain;
  private static retrievalChain: RetrievalQAChain;
  private static conversationalRetrievalChain: ConversationalRetrievalQAChain;

  private chatPrompt:  ChatPromptTemplate;
  private vectorStore: MemoryVectorStore;

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

  private validateChatModel(chatModel: BaseChatModel): void {
    if (chatModel === undefined || chatModel === null) throw new Error('No chat model set');
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
      localAIModel,
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
          localAIModel,
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

    const OpenAIEmbeddingsAPI = new OpenAIEmbeddings({
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
      case LOCALAI:
        return new ProxyOpenAIEmbeddings({
          openAIApiKey,
          openAIProxyBaseUrl,
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
        })
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
      new Notice(`API key is not provided for the model: ${modelDisplayName}`);
      console.error(`API key is not provided for the model: ${modelDisplayName}`);
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
      }

      AIState.chatModel = newModelInstance;
    } catch (error) {
      console.error(error);
      new Notice(`Error creating model: ${modelDisplayName}`);
    }
  }

  setModel(newModelDisplayName: string): void {
    // model and model display name must be update at the same time!
    let newModel = getModelName(newModelDisplayName);
    const {localAIModel} = this.langChainParams;

    if (newModelDisplayName === ChatModelDisplayNames.LOCAL_AI) {
      if (!localAIModel) {
        new Notice('No local AI model provided! Please set it in settings first.');
        console.error('No local AI model provided! Please set it in settings first.');
        return;
      }
      if (!this.langChainParams.openAIProxyBaseUrl) {
        new Notice('Please set the OpenAI Proxy Base URL in settings.');
        console.error('Please set the OpenAI Proxy Base URL in settings.');
        return;
      }
      newModel = localAIModel;
    }
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
    this.validateChatModel(AIState.chatModel);
    this.validateChainType(chainType);

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        if (options.forceNewCreation) {
          AIState.chain = ChainFactory.createNewLLMChain({
            llm: AIState.chatModel,
            memory: this.memory,
            prompt: options.prompt || this.chatPrompt,
          }) as ConversationChain;
        } else {
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
    // Check if chain is initialized properly
    if (!isSupportedChain(AIState.chain)) {
      console.error(
        'Chain is not initialized properly, re-initializing chain: ',
        this.langChainParams.chainType
      );
      this.setChain(this.langChainParams.chainType, this.langChainParams.options);
    }

    let fullAIResponse = '';
    try {
      switch(this.langChainParams.chainType) {
        case ChainType.LLM_CHAIN:
          if (debug) {
            console.log('chain:', AIState.chain);
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
      new Notice(`LangChain error: ${errorCode}`);
      console.error(errorData);
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
