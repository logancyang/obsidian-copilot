import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";

export class ActionBlockStreamer {
  private buffer = "";

  constructor(
    private toolManager: typeof ToolManager,
    private writeFileTool: unknown
  ) {}

  private findCompleteBlock(str: string) {
    const regex = /<writeFile>[\s\S]*?<\/writeFile>/;
    const match = str.match(regex);

    if (!match || match.index === undefined) {
      return null;
    }

    return {
      block: match[0],
      endIdx: match.index + match[0].length,
    };
  }

  async *processChunk(
    chunk: Record<string, unknown>
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    let chunkContent = "";

    if (Array.isArray(chunk.content)) {
      for (const item of chunk.content as Array<{ type?: string; text?: unknown }>) {
        if (item.type === "text" && item.text != null) {
          chunkContent += typeof item.text === "string" ? item.text : "";
        }
      }
    } else if (chunk.content != null) {
      chunkContent = typeof chunk.content === "string" ? chunk.content : "";
    }

    if (chunkContent) {
      this.buffer += chunkContent;
    }

    yield chunk;

    let blockInfo = this.findCompleteBlock(this.buffer);

    while (blockInfo) {
      const { block, endIdx } = blockInfo;

      const pathMatch = block.match(/<path>([\s\S]*?)<\/path>/);
      const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/);
      const filePath = pathMatch ? pathMatch[1].trim() : undefined;
      const fileContent = contentMatch ? contentMatch[1].trim() : undefined;

      try {
        const result = await this.toolManager.callTool(this.writeFileTool, {
          path: filePath,
          content: fileContent,
        });

        const formattedResult = ToolResultFormatter.format("writeFile", result as string);
        yield { ...chunk, content: `\n${formattedResult}\n` };
      } catch (err: unknown) {
        yield { ...chunk, content: `\nError: ${(err as Error)?.message ?? String(err)}\n` };
      }

      this.buffer = this.buffer.substring(endIdx);

      blockInfo = this.findCompleteBlock(this.buffer);
    }
  }
}
