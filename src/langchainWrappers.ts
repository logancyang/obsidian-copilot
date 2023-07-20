import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Configuration, OpenAIApi } from "openai";

export class ProxyChatOpenAI extends ChatOpenAI {
  constructor(
    fields?: any,
  ) {
    super(fields ?? {});

    const clientConfig = new Configuration({
      ...this["clientConfig"],
      basePath: fields.openAIProxyBaseUrl,
    });

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAIApi(clientConfig);
  }
}
