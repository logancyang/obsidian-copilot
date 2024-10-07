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
