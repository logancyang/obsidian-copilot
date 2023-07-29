import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Configuration, OpenAIApi } from "openai";

export class ProxyChatOpenAI extends ChatOpenAI {
  constructor(
    fields?: any,
  ) {
    super(fields ?? {});

    const modelName = fields.useLocalProxy ? fields.localAIModel : fields.modelName;
    if (fields.useLocalProxy) {
      console.log('Using local proxy, LocalAI model: ', modelName);
    }

    const clientConfig = new Configuration({
      ...this["clientConfig"],
      modelName,
      basePath: fields.openAIProxyBaseUrl,
    });

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAIApi(clientConfig);
  }
}
