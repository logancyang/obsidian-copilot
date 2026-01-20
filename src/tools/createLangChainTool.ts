/**
 * Helper function to create LangChain tools using the modern tool() API.
 * This replaces the old SimpleTool/createTool pattern with native LangChain tools.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Options for creating a LangChain tool
 */
export interface CreateToolOptions<TSchema extends z.ZodType> {
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

/**
 * Common schema types for reuse across tools
 */
export const CommonSchemas = {
  emptyParams: z.object({}),
  stringParam: (description: string) => z.string().describe(description),
  numberParam: (description: string) => z.number().describe(description),
  booleanParam: (description: string) => z.boolean().describe(description),
  optionalString: (description: string) => z.string().optional().describe(description),
  nonEmptyString: (description: string) => z.string().min(1).describe(description),
  url: (description: string) => z.string().url().describe(description),
  email: (description: string) => z.string().email().describe(description),
} as const;

/**
 * Extract description from a Zod schema field, handling wrapped types.
 */
function getZodDescription(schema: z.ZodType): string {
  // Handle optional/nullable/default wrappers
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return getZodDescription(schema._def.innerType);
  }

  // @ts-ignore - accessing private _def property
  return schema._def.description || "";
}

/**
 * Extract parameter descriptions from Zod schema for tool description generation.
 * Used by chain runners to generate XML tool format prompts.
 */
export function extractParametersFromZod(schema: z.ZodType): Record<string, string> {
  const descriptions: Record<string, string> = {};

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      descriptions[key] = getZodDescription(zodField) || "No description";
    }
  } else if (schema instanceof z.ZodVoid) {
    // No parameters for void schema
    return {};
  } else if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    // For unions, we could extract common fields or return a special description
    descriptions._union = "Multiple parameter formats supported";
  }

  return descriptions;
}
