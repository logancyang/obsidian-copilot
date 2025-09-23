import { Notice } from "obsidian";

export const getToolDescription = (tool: string): string => {
  switch (tool) {
    case "@vault":
      return "Search through your vault for relevant information";
    case "@websearch":
      return "Search the web for information";
    case "@youtube":
      return "Get the transcript of a YouTube video. Example: @youtube <video_url>";
    case "@pomodoro":
      return "Start a pomodoro timer. Example: @pomodoro 25m";
    case "@composer":
      return "Edit existing notes or create new notes.";
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
