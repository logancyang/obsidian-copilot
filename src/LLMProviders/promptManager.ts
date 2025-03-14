import { getSystemPrompt, subscribeToSettingsChange } from "@/settings/model";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";

export default class PromptManager {
  private static instance: PromptManager;
  private chatPrompt: ChatPromptTemplate;
  private qaPrompt: ChatPromptTemplate;
  private projectPrompt: ChatPromptTemplate;

  private constructor() {
    this.initChatPrompt();
    this.initQAPrompt();
    this.initProjectPrompt();

    subscribeToSettingsChange(() => {
      this.initChatPrompt();
      this.initQAPrompt();
      this.initProjectPrompt();
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

  private initQAPrompt(): void {
    const qaTemplate = `{system_message}

Answer the question with as detailed as possible based only on the following context:
{context}

Question: {question}
`;

    this.qaPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(qaTemplate),
    ]);
  }

  private initProjectPrompt() {
    const projectTemplate = `{system_message}

Answer the question with as detailed as possible based only on the following context:
{context}

Question: {question}
`;

    this.projectPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(projectTemplate),
    ]);
  }

  // Add this new method to escape curly braces
  private escapeTemplateString(str: string): string {
    return str.replace(/\{/g, "{{").replace(/\}/g, "}}");
  }

  getChatPrompt(): ChatPromptTemplate {
    return this.chatPrompt;
  }

  async getQAPrompt({
    question,
    context,
    systemMessage,
  }: {
    question: string;
    context: string;
    systemMessage: string;
  }): Promise<string> {
    const promptResult = await this.qaPrompt.format({
      question,
      context,
      system_message: systemMessage,
    });
    return promptResult;
  }

  async getProjectPrompt({
    question,
    context,
    systemMessage,
  }: {
    question: string;
    context: string;
    systemMessage: string;
  }): Promise<string> {
    const promptResult = await this.projectPrompt.format({
      question,
      context,
      system_message: systemMessage,
    });
    return promptResult;
  }
}
