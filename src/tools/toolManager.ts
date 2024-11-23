export const getToolDescription = (tool: string): string => {
  switch (tool) {
    case "@vault":
      return "Search through your vault for relevant information";
    case "@web":
      return "Search the web for information";
    case "@youtube":
      return "Get the transcript of a YouTube video. Example: @youtube <video_url>";
    case "@pomodoro":
      return "Start a pomodoro timer. Example: @pomodoro 25m";
    default:
      return "";
  }
};

export class ToolManager {
  static async callTool(tool: any, args: any): Promise<any> {
    try {
      return await tool.call(args);
    } catch (error) {
      console.error(`Error calling tool: ${error}`);
      return null;
    }
  }
}
