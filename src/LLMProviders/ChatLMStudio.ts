import { ChatOpenAI } from "@langchain/openai";

/**
 * ChatLMStudio extends ChatOpenAI with the Responses API (/v1/responses)
 * for LM Studio local inference.
 *
 * Patches LangChain/OpenAI SDK compatibility issues with LM Studio:
 * - Ensures text.format is always set (LM Studio requires it)
 * - Removes strict:null from tool definitions (LM Studio rejects it)
 */
export interface ChatLMStudioInput {
  modelName?: string;
  apiKey?: string;
  configuration?: any;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  [key: string]: any;
}

/**
 * Create a fetch wrapper that sanitizes request bodies for LM Studio
 * compatibility. This intercepts at the HTTP level, which is the last
 * stop before the request is sent, guaranteeing all null values in
 * tools are stripped regardless of which LangChain code path produced them.
 */
function createLMStudioFetch(baseFetch?: typeof globalThis.fetch): typeof globalThis.fetch {
  const underlyingFetch = baseFetch || globalThis.fetch;

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        let modified = false;

        // Strip null/undefined values from tool definitions
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
      } catch {
        // Not JSON, pass through unchanged
      }
    }
    return underlyingFetch(input, init);
  };
}

export class ChatLMStudio extends ChatOpenAI {
  constructor(fields: ChatLMStudioInput) {
    const originalFetch = fields.configuration?.fetch;

    super({
      ...fields,
      useResponsesApi: true,
      configuration: {
        ...fields.configuration,
        // Wrap fetch to sanitize request bodies for LM Studio compatibility
        fetch: createLMStudioFetch(originalFetch),
      },
      // modelKwargs is spread LAST in ChatOpenAIResponses.invocationParams(),
      // overriding the computed `text` field. Without this, LangChain emits
      // `text: { format: undefined }` (serializes to `text: {}`) which LM Studio
      // rejects with "Required: text.format".
      modelKwargs: {
        ...fields.modelKwargs,
        text: { format: { type: "text" } },
      },
    });
  }
}
