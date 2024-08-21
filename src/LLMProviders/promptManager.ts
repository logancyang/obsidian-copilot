import { LangChainParams } from "@/aiParams";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";

export default class PromptManager {
  private static instance: PromptManager;
  private chatPrompt: ChatPromptTemplate;

  private constructor(private langChainParams: LangChainParams) {
    this.initChatPrompt();
  }

  static getInstance(langChainParams: LangChainParams): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager(langChainParams);
    }
    return PromptManager.instance;
  }

  private initChatPrompt(): void {
    this.chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(this.langChainParams.systemMessage),
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);
  }

  getChatPrompt(): ChatPromptTemplate {
    return this.chatPrompt;
  }
}
