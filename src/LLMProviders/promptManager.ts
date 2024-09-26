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
    // Escape curly braces in the system message
    const escapedSystemMessage = this.escapeTemplateString(this.langChainParams.systemMessage);

    this.chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(escapedSystemMessage),
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);
  }

  // Add this new method to escape curly braces
  private escapeTemplateString(str: string): string {
    return str.replace(/\{/g, "{{").replace(/\}/g, "}}");
  }

  getChatPrompt(): ChatPromptTemplate {
    return this.chatPrompt;
  }
}
