/**
 * Helper function to create LangChain tools using the modern tool() API.
 * This replaces the old SimpleTool/createTool pattern with native LangChain tools.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Options for creating a LangChain tool
 */
interface CreateToolOptions<TSchema extends z.ZodType> {
  name: string;
  description: string;
  schema: TSchema;
  func: (args: z.infer<TSchema>) => Promise<string | object>;
}

/**
 * Create a LangChain tool using the modern tool() API.
 * Returns a StructuredTool compatible with bindTools().
 *
 * @example
 * ```typescript
 * const myTool = createLangChainTool({
 *   name: "myTool",
 *   description: "Does something useful",
 *   schema: z.object({
 *     query: z.string().describe("The query to process"),
 *   }),
 *   func: async ({ query }) => {
 *     // Implementation
 *     return JSON.stringify({ result: query });
 *   },
 * });
 * ```
 */
export function createLangChainTool<TSchema extends z.ZodType>(
  options: CreateToolOptions<TSchema>
) {
  return tool(
    async (args: z.infer<TSchema>) => {
      const result = await options.func(args);
      // Ensure result is always a string for LangChain compatibility
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
    }
  );
}
