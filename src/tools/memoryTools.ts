import { z } from "zod";
import { createTool, SimpleTool } from "./SimpleTool";
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
export const updateMemoryTool: SimpleTool<
  typeof memorySchema,
  { success: boolean; message: string }
> = createTool({
  name: "updateMemoryTool",
  description: "Update the user memory when the user explicitly asks to update the memory",
  schema: memorySchema,
  handler: async ({ statement }) => {
    try {
      const memoryManager = new UserMemoryManager(app);
      const chatModel = ChatModelManager.getInstance().getChatModel();
      const updatedMemory = await memoryManager.updateSavedMemory(statement, chatModel);
      if (!updatedMemory.success) {
        return {
          success: false,
          message: `Failed to update memory: ${statement}`,
        };
      }
      const memoryFilePath = memoryManager.getSavedMemoriesFilePath();

      return {
        success: true,
        message: `Memory updated successfully into ${memoryFilePath}: ${updatedMemory.content}`,
      };
    } catch (error) {
      logError("[updateMemoryTool] Error updating memory:", error);

      return {
        success: false,
        message: `Failed to save memory: ${error.message}`,
      };
    }
  },
});
