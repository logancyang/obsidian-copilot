import { logWarn } from "@/logger";

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
  /**
   * Call a tool with the given arguments.
   * Throws on error so caller can handle with proper context (args, tool name).
   */
  static async callTool(tool: unknown, args: unknown): Promise<unknown> {
    if (!tool) {
      throw new Error("Tool is undefined");
    }

    const typedTool = tool as { call: (args: unknown) => Promise<unknown>; name: string };
    const result = await typedTool.call(args);

    if (result === undefined || result === null) {
      logWarn(`[ToolCall] Tool "${typedTool.name}" returned null/undefined`);
      return null;
    }

    return result;
  }
}
