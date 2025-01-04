import { JinaEmbeddings, JinaEmbeddingsParams } from "@langchain/community/embeddings/jina";

export class CustomJinaEmbeddings extends JinaEmbeddings {
  constructor(
    fields?: Partial<JinaEmbeddingsParams> & {
      apiKey?: string;
      baseUrl?: string;
    }
  ) {
    super(fields);
    if (fields?.baseUrl) {
      this.baseUrl = fields.baseUrl;
    }
  }
}
