/**
 * Simple tool interface to replace LangChain tool wrapper
 * Provides a minimal, clean interface for tool definitions
 */

import { z } from "zod";

// Common schema types for reuse
export const CommonSchemas = {
  emptyParams: z.void(),
  stringParam: (description: string) => z.string().describe(description),
  numberParam: (description: string) => z.number().describe(description),
  booleanParam: (description: string) => z.boolean().describe(description),
  optionalString: (description: string) => z.string().optional().describe(description),
  nonEmptyString: (description: string) => z.string().min(1).describe(description),
  url: (description: string) => z.string().url().describe(description),
  email: (description: string) => z.string().email().describe(description),
} as const;

export interface SimpleTool<TSchema extends z.ZodType = z.ZodVoid, TOutput = any> {
  name: string;
  description: string;
  schema: TSchema;
  call: (args: z.infer<TSchema>) => Promise<TOutput>;
  timeoutMs?: number;
  isBackground?: boolean; // If true, tool execution is not shown to user
  isPlusOnly?: boolean; // If true, tool requires Plus subscription
  // Future extensibility fields
  version?: string; // Tool version for compatibility
  deprecated?: boolean; // Mark tools for future removal
  metadata?: Record<string, unknown>; // Additional tool metadata
}

export interface CreateToolOptions<TSchema extends z.ZodType, TOutput = any> {
  name: string;
  description: string;
  schema: TSchema;
  handler: (args: z.infer<TSchema>) => Promise<TOutput>;
  timeoutMs?: number;
  isBackground?: boolean;
  isPlusOnly?: boolean;
  version?: string;
  deprecated?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Create a tool with Zod schema validation
 * This is the only way to create tools - ensures type safety and validation
 */
export function createTool<TSchema extends z.ZodType, TOutput = any>(
  options: CreateToolOptions<TSchema, TOutput>
): SimpleTool<TSchema, TOutput> {
  return {
    name: options.name,
    description: options.description,
    schema: options.schema,
    call: async (args: any) => {
      try {
        // Handle empty objects for void schemas
        if (
          options.schema instanceof z.ZodVoid &&
          args &&
          typeof args === "object" &&
          Object.keys(args).length === 0
        ) {
          args = undefined;
        }

        // Validate at runtime with better error handling
        const validated = options.schema.parse(args);
        return await options.handler(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          // Format Zod errors for better readability
          const formattedErrors = error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", ");
          throw new Error(`Tool ${options.name} validation failed: ${formattedErrors}`);
        }
        throw error;
      }
    },
    timeoutMs: options.timeoutMs,
    isBackground: options.isBackground,
    isPlusOnly: options.isPlusOnly,
    version: options.version,
    deprecated: options.deprecated,
    metadata: options.metadata,
  };
}

/**
 * Extract parameter descriptions from Zod schema for tool description generation
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
  // Add more schema types as needed

  return descriptions;
}

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
 * Helper to create a tool that validates input asynchronously
 * Useful when validation requires external checks (e.g., file existence)
 */
export function createAsyncTool<TSchema extends z.ZodType, TOutput = any>(
  options: CreateToolOptions<TSchema, TOutput> & {
    asyncValidator?: (args: z.infer<TSchema>) => Promise<void>;
  }
): SimpleTool<TSchema, TOutput> {
  const tool = createTool(options);

  if (options.asyncValidator) {
    const originalCall = tool.call;
    tool.call = async (args: any) => {
      const validated = options.schema.parse(args);
      await options.asyncValidator!(validated);
      return originalCall(args);
    };
  }

  return tool;
}
