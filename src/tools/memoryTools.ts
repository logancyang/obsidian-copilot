import { z } from "zod";
import { createTool, SimpleTool } from "./SimpleTool";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { logError } from "@/logger";

// Define Zod schema for memoryTool
const memorySchema = z.object({
  memoryContent: z
    .string()
    .min(1)
    .describe(
      "The content to save to user's memory (information the user explicitly asked to remember)"
    ),
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
    handler: async ({ memoryContent }) => {
      try {
        const memoryManager = new UserMemoryManager(app);
        const success = await memoryManager.addSavedMemory(memoryContent);
        if (!success) {
          return {
            success: false,
            message: `Failed to save memory: ${memoryContent}`,
          };
        }
        const memoryFilePath = memoryManager.getSavedMemoriesFilePath();

        return {
          success: true,
          message: `Memory saved successfully into ${memoryFilePath}: ${memoryContent}`,
        };
      } catch (error) {
        logError("[memoryTool] Error saving memory:", error);

        return {
          success: false,
          message: `Failed to save memory: ${error.message}`,
        };
      }
    },
  });
