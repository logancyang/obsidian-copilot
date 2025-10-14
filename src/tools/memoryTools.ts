import { z } from "zod";
import { createTool, SimpleTool } from "./SimpleTool";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { logError } from "@/logger";

// Define Zod schema for memoryTool
const memorySchema = z.object({
  query: z.string().min(1).describe("The user query for explicitly updating saved memories"),
});

/**
 * Memory tool for saving information that the user explicitly asks the assistant to remember
 */
export const memoryTool: SimpleTool<typeof memorySchema, { success: boolean; message: string }> =
  createTool({
    name: "memoryTool",
    description:
      "Save information to user memory when the user explicitly asks to remember something",
    schema: memorySchema,
    handler: async ({ query }) => {
      try {
        const memoryManager = new UserMemoryManager(app);
        const success = await memoryManager.updateSavedMemory(query, chatModel);
        if (!success) {
          return {
            success: false,
            message: `Failed to update memory: ${query}`,
          };
        }
        const memoryFilePath = memoryManager.getSavedMemoriesFilePath();

        return {
          success: true,
          message: `Memory updated successfully into ${memoryFilePath}: ${query}`,
        };
      } catch (error) {
        logError("[memoryTool] Error updating memory:", error);

        return {
          success: false,
          message: `Failed to save memory: ${error.message}`,
        };
      }
    },
  });
