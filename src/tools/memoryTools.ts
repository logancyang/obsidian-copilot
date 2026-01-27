import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { logError } from "@/logger";
import ChatModelManager from "@/LLMProviders/chatModelManager";

// Define Zod schema for updateMemoryTool
const memorySchema = z.object({
  statement: z
    .string()
    .min(1)
    .describe("The user statement for explicitly updating saved memories"),
});

/**
 * Memory tool for saving information that the user explicitly asks the assistant to remember
 */
export const updateMemoryTool = createLangChainTool({
  name: "updateMemory",
  description: "Update the user memory when the user explicitly asks to update the memory",
  schema: memorySchema,
  func: async ({ statement }) => {
    try {
      const memoryManager = new UserMemoryManager(app);
      const chatModel = ChatModelManager.getInstance().getChatModel();
      const result = await memoryManager.updateSavedMemory(statement, chatModel);

      if (result.error) {
        return {
          success: false,
          message: result.error,
        };
      }

      const memoryFilePath = memoryManager.getSavedMemoriesFilePath();
      return {
        success: true,
        message: `Memory updated successfully into ${memoryFilePath}: ${result.content}`,
      };
    } catch (error: any) {
      logError("[updateMemoryTool] Error updating memory:", error);

      return {
        success: false,
        message: `Failed to save memory: ${error.message}`,
      };
    }
  },
});
