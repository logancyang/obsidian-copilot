import { ToolManager } from "@/tools/toolManager";

/**
 * ComposerBlockStreamer processes streaming chunks to detect and handle writeToFile blocks.
 *
 * ## Buffer Queue Approach
 *
 * This streamer uses a buffer queue of up to 5 chunks to handle cases where XML tags
 * are split across multiple chunks. This prevents partial tags like "<write" from being
 * shown to the user while still allowing smooth content flow.
 *
 * ### How it works:
 *
 * 1. **Buffering**: Incoming chunks are added to a queue (max 5 chunks)
 * 2. **Block Detection**: The combined buffer is searched for complete writeToFile blocks
 * 3. **Tag Processing**: Complete blocks are processed and their content is yielded
 * 4. **Buffer Rebuilding**: After processing a block, the `bufferQueue` is rebuilt
 *    from the remaining content. This allows for multiple blocks within the same
 *    buffer to be handled iteratively.
 * 5. **Unclosed Tag Handling**: Partial/unclosed tags trigger a "Generating changes..." message
 * 6. **Safe Yielding**: When buffer is full (5 chunks) with no tags, the first chunk is safe to yield
 * 7. **Cleanup**: Remaining buffered content can be retrieved via getBufferedChunks()
 *
 * ### Supported Formats:
 * - `<writeToFile><path>...</path><content>...</content></writeToFile>`
 * - ````xml<writeToFile><path>...</path><content>...</content></writeToFile>````
 *
 * ### Edge Cases Handled:
 * - Partial tags split across chunks: `"<write"` + `"ToFile>"`
 * - Multiple blocks in single chunk
 * - Nested or malformed XML
 * - Content before/after blocks
 *
 * @example
 * ```typescript
 * const streamer = new ComposerBlockStreamer(ToolManager, writeToFileTool);
 *
 * for await (const chunk of chatStream) {
 *   for await (const processedChunk of streamer.processChunk(chunk)) {
 *     // Process yielded chunks
 *   }
 * }
 *
 * // Handle any remaining buffered content
 * const remaining = streamer.getBufferedChunks();
 * if (remaining) {
 *   // Process remaining content
 * }
 * ```
 */
export class ComposerBlockStreamer {
  // Define a constant for the max buffer size
  private static readonly MAX_BUFFER_SIZE = 5;
  private bufferQueue: string[] = [];
  private waitingMessagePrinted = false;

  constructor(
    private toolManager: typeof ToolManager,
    private writeToFileTool: any
  ) {}

  private findNextBlock(str: string) {
    // Regex for both formats. Not global to find the first match.
    const regex = /(```xml\s*)?<writeToFile>[\s\S]*?<\/writeToFile>(\s*```)?/;
    const match = str.match(regex);

    if (!match || match.index === undefined) {
      return null;
    }

    return {
      block: match[0],
      openIdx: match.index,
      endIdx: match.index + match[0].length,
      isXml: !!match[1],
    };
  }

  public getBufferedChunks(): string {
    return this.bufferQueue.join("");
  }

  async *processChunk(chunk: any): AsyncGenerator<any, void, unknown> {
    if (typeof chunk.content !== "string") {
      yield chunk;
      return;
    }
    // Add new chunk to the buffer queue
    this.bufferQueue.push(chunk.content);
    let buffer = this.bufferQueue.join("");

    let blockInfo;
    // Process all complete blocks in the buffer
    while ((blockInfo = this.findNextBlock(buffer)) !== null) {
      const { block, openIdx, endIdx, isXml } = blockInfo;

      // Yield content that came before the block
      const contentBefore = buffer.substring(0, openIdx);
      if (contentBefore) {
        yield { ...chunk, content: contentBefore };
      }

      // Extract content from the block for the tool call
      let innerBlock = block;
      if (isXml) {
        innerBlock = innerBlock.replace(/^```xml\n/, "").replace(/\n```$/, "");
      }
      const pathMatch = innerBlock.match(/<path>([\s\S]*?)<\/path>/);
      const contentMatch = innerBlock.match(/<content>([\s\S]*?)<\/content>/);
      const filePath = pathMatch ? pathMatch[1].trim() : undefined;
      const fileContent = contentMatch ? contentMatch[1].trim() : undefined;

      // Yield waiting message, call the tool, and yield the result
      yield {
        ...chunk,
        content: "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      };

      let result = "";
      try {
        result = await this.toolManager.callTool(this.writeToFileTool, {
          path: filePath,
          content: fileContent,
        });
      } catch (err: any) {
        result = `Error: ${err?.message || err}`;
      }

      yield { ...chunk, content: `File change result: ${result}\n` };

      // A block was successfully processed, so the section is now closed.
      this.waitingMessagePrinted = false;

      // Remove the processed block from the buffer
      buffer = buffer.substring(endIdx);
      // Rebuild the bufferQueue from the remaining buffer
      this.bufferQueue = buffer ? [buffer] : [];
    }

    // After processing all complete blocks, check if the remainder contains an unclosed tag
    const openTagRegex = /(```xml\s*)?<writeToFile>/;
    const openTagMatch = buffer.match(openTagRegex);

    if (openTagMatch && openTagMatch.index !== undefined) {
      // An unclosed tag was found.
      // Yield any content that came before this tag.
      const contentBeforeTag = buffer.substring(0, openTagMatch.index);
      if (contentBeforeTag) {
        yield { ...chunk, content: contentBeforeTag };
      }

      // The rest of the buffer is the start of a block. Keep it.
      buffer = buffer.substring(openTagMatch.index);
      this.bufferQueue = buffer ? [buffer] : [];

      // If we haven't already, yield the "Generating changes..." message.
      if (!this.waitingMessagePrinted) {
        yield { ...chunk, content: "Generating changes ..." };
        this.waitingMessagePrinted = true;
      }
    }

    // If buffer is full and no open tag found, yield the first chunk
    while (this.bufferQueue.length >= ComposerBlockStreamer.MAX_BUFFER_SIZE) {
      const firstChunk = this.bufferQueue.shift()!;
      yield { ...chunk, content: firstChunk };
    }
  }
}
