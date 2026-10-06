import { logWarn } from "@/logger";
import { ChatOpenAI } from "@langchain/openai";

export interface ChatLMStudioInput {
  modelName?: string;
  apiKey?: string;
  configuration?: Record<string, unknown>;
  maxTokens?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  [key: string]: unknown;
}

function createLMStudioFetch(baseFetch?: typeof window.fetch): typeof window.fetch {
  const underlyingFetch = baseFetch || window.fetch;

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as { tools?: unknown };
        let modified = false;

        if (Array.isArray(body.tools)) {
          body.tools = body.tools.map((tool: Record<string, unknown>) => {
            const cleaned: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(tool)) {
              if (value !== null && value !== undefined) {
                cleaned[key] = value;
              }
            }
            return cleaned;
          });
          modified = true;
        }

        if (modified) {
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch (error) {
        logWarn("[ChatLMStudio] Sending a request body that is not JSON unchanged", error);
      }
    }
    return underlyingFetch(input, init);
  };
}

export class ChatLMStudio extends ChatOpenAI {
  constructor(fields: ChatLMStudioInput) {
    const configuration = fields.configuration as { fetch?: typeof window.fetch } | undefined;
    const originalFetch = configuration?.fetch;

    super({
      ...fields,
      useResponsesApi: true,
      configuration: {
        ...fields.configuration,
        fetch: createLMStudioFetch(originalFetch),
      },
      modelKwargs: {
        ...(fields.modelKwargs as Record<string, unknown> | undefined),
        text: { format: { type: "text" } },
      },
    });
  }
}
