import { Notice } from "obsidian";

export const getToolDescription = (tool: string): string => {
  switch (tool) {
    case "@vault":
      return "Search through your vault for relevant information";
    case "@websearch":
      return "Search the web for information";
    case "@composer":
      return "Edit existing notes or create new notes.";
    case "@memory":
      return "Save information to user memory";
    default:
      return "";
  }
};

export class ToolManager {
  static async callTool(tool: any, args: any): Promise<any> {
    try {
      if (!tool) {
        throw new Error("Tool is undefined");
      }

      const result = await tool.call(args);

      if (result === undefined || result === null) {
        console.warn(`Tool ${tool.name} returned null/undefined result`);
        return null;
      }

      return result;
    } catch (error) {
      console.error(`Error calling tool:`, error);
      if (error instanceof Error) {
        new Notice(error.message);
      } else {
        new Notice("An error occurred while executing the tool. Check console for details.");
      }
      return null;
    }
  }
}
