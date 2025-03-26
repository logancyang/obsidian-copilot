import { tool } from "@langchain/core/tools";
import { z } from "zod";

const composerTool = tool(
  async ({
    message,
    chatHistory,
  }: {
    message: string;
    chatHistory: { role: string; content: string }[];
  }) => {
    // Implementation will be added later
    console.log("message=", message);
    console.log("chatHistory=", chatHistory);
  },
  {
    name: "composer",
    description: "Create new note content based on the query and chat context",
    schema: z.object({
      message: z.string().describe("The composition message including the note context"),
      chatHistory: z
        .array(
          z.object({
            role: z.string(),
            content: z.string(),
          })
        )
        .describe("Previous conversation turns with role and content"),
    }),
  }
);

export { composerTool };
