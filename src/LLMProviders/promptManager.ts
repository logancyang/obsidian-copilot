import { subscribeToSettingsChange } from "@/settings/model";
import { getSystemPrompt } from "@/system-prompts/systemPromptBuilder";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";

export default class PromptManager {
  private static instance: PromptManager;
  private chatPrompt: ChatPromptTemplate;

  private constructor() {
    this.initChatPrompt();

    subscribeToSettingsChange(() => {
      this.initChatPrompt();
    });
  }

  static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager();
    }
    return PromptManager.instance;
  }

  private initChatPrompt(): void {
    // Escape curly braces in the system message
    const escapedSystemMessage = this.escapeTemplateString(getSystemPrompt());

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
