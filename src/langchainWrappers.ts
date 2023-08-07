import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { Configuration, OpenAIApi } from "openai";

export class ProxyChatOpenAI extends ChatOpenAI {
  constructor(
    fields?: any,
  ) {
    super(fields ?? {});

    // Use LocalAIModel if it is set
    const modelName = fields.localAIModel ? fields.localAIModel : fields.modelName;

    const clientConfig = new Configuration({
      ...this["clientConfig"],
      modelName,
      basePath: fields.openAIProxyBaseUrl,
    });

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAIApi(clientConfig);
  }
}

export class ProxyOpenAIEmbeddings extends OpenAIEmbeddings {
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
