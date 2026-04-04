import { logInfo } from "@/logger";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

/**
 * Tool to create a directory in the vault.
 */
const createDirectoryTool = createLangChainTool({
  name: "createDirectory",
  description: "Create a new folder/directory in the vault",
  schema: z.object({
    path: z
      .string()
      .min(1)
      .describe("The path of the directory to create (e.g. 'Projects/NewProject')"),
  }),
  func: async ({ path }) => {
    try {
      const vault = app.vault;

      // Check if directory already exists
      const existing = vault.getAbstractFileByPath(path);
      if (existing) {
        return {
          success: true,
          message: `Directory "${path}" already exists.`,
          path,
        };
      }

      // Create the directory (createFolder handles nested paths)
      await vault.createFolder(path);
      logInfo(`[createDirectory] Created directory: ${path}`);

      return {
        success: true,
        message: `Directory "${path}" created successfully.`,
        path,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to create directory "${path}": ${error.message}`,
      };
    }
  },
});

export { createDirectoryTool };
