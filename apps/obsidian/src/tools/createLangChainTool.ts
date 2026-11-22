import { tool } from "@langchain/core/tools";
import * as z from "zod";

interface CreateToolOptions<TSchema extends z.ZodType> {
  name: string;
  description: string;
  schema: TSchema;
  func: (args: z.infer<TSchema>) => Promise<string | object>;
}

export function createLangChainTool<TSchema extends z.ZodType>(
  options: CreateToolOptions<TSchema>
) {
  return tool(
    async (args: z.infer<TSchema>) => {
      const result = await options.func(args);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
    }
  );
}
