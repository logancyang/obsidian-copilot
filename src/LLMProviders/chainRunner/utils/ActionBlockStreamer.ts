import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";

/**
 * ActionBlockStreamer processes streaming chunks to detect and handle writeToFile blocks.
 *
 * 1. Accumulates chunks in a buffer
 * 2. Detects complete writeToFile blocks
 * 3. Calls the writeToFile tool when a complete block is found
 * 4. Returns chunks as-is otherwise
 */
export class ActionBlockStreamer {
  private buffer = "";

  constructor(
    private toolManager: typeof ToolManager,
    private writeToFileTool: any
  ) {}

  private findCompleteBlock(str: string) {
    // Regex for both formats
    const regex = /<writeToFile>[\s\S]*?<\/writeToFile>/;
    const match = str.match(regex);

    if (!match || match.index === undefined) {
      return null;
    }

    return {
      block: match[0],
      endIdx: match.index + match[0].length,
    };
  }

  async *processChunk(chunk: any): AsyncGenerator<any, void, unknown> {
    // Handle different chunk formats
    let chunkContent = "";

    // Handle Claude thinking model array-based content
    if (Array.isArray(chunk.content)) {
      for (const item of chunk.content) {
        if (item.type === "text" && item.text != null) {
          chunkContent += item.text;
        }
      }
    }
    // Handle standard string content
    else if (chunk.content != null) {
      chunkContent = chunk.content;
    }

    // Add to buffer
    if (chunkContent) {
      this.buffer += chunkContent;
    }

    // Yield the original chunk as-is
    yield chunk;

    // Process all complete blocks in the buffer
    let blockInfo = this.findCompleteBlock(this.buffer);

    while (blockInfo) {
      const { block, endIdx } = blockInfo;

      // Extract content from the block
      const pathMatch = block.match(/<path>([\s\S]*?)<\/path>/);
      const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/);
      const filePath = pathMatch ? pathMatch[1].trim() : undefined;
      const fileContent = contentMatch ? contentMatch[1].trim() : undefined;

      // Call the tool
      try {
        const result = await this.toolManager.callTool(this.writeToFileTool, {
          path: filePath,
          content: fileContent,
        });

        // Format tool result using ToolResultFormatter for consistency with agent mode
        const formattedResult = ToolResultFormatter.format("writeToFile", result);
        yield { ...chunk, content: `\n${formattedResult}\n` };
      } catch (err: any) {
        yield { ...chunk, content: `\nError: ${err?.message || err}\n` };
      }

      // Remove processed block from buffer
      this.buffer = this.buffer.substring(endIdx);

      // Check for another complete block in the remaining buffer
      blockInfo = this.findCompleteBlock(this.buffer);
    }
  }
}
