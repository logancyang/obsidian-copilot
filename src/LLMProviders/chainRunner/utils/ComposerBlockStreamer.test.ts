import { ComposerBlockStreamer } from "./ComposerBlockStreamer";
import { ToolManager } from "@/tools/toolManager";

// Mock the ToolManager
jest.mock("@/tools/toolManager");

const MockedToolManager = ToolManager as jest.Mocked<typeof ToolManager>;

describe("ComposerBlockStreamer", () => {
  let writeToFileTool: any;
  let streamer: ComposerBlockStreamer;

  beforeEach(() => {
    writeToFileTool = { name: "writeToFile" }; // A simple mock object
    MockedToolManager.callTool.mockClear();
    streamer = new ComposerBlockStreamer(MockedToolManager, writeToFileTool);
  });

  // Helper function to process chunks and collect results
  async function processChunks(chunks: { content: string | null }[]) {
    const outputContents: string[] = [];
    for (const chunk of chunks) {
      for await (const result of streamer.processChunk(chunk)) {
        if (result.content) {
          outputContents.push(result.content);
        }
      }
    }
    return outputContents;
  }

  it("should pass through chunks without writeToFile tags", async () => {
    const chunks = [{ content: "Hello " }, { content: "world, this is " }, { content: "a test." }];
    const output = await processChunks(chunks);
    // With buffer queue, chunks are held until buffer is full (5 chunks) or stream ends
    // Since we only have 3 chunks, they're all buffered
    expect(output).toEqual([]);

    // Content should be available via getBufferedChunks()
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe("Hello world, this is a test.");
  });

  it("should handle a complete writeToFile block in a single chunk", async () => {
    MockedToolManager.callTool.mockResolvedValue("File written successfully.");
    const chunks = [
      {
        content:
          "Some text before <writeToFile><path>file.txt</path><content>content</content></writeToFile> and some text after.",
      },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "Some text before ",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: File written successfully.\n",
    ]);
    // Content after the block should be in buffer
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe(" and some text after.");
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "file.txt",
      content: "content",
    });
  });

  it("should handle a complete xml-wrapped writeToFile block", async () => {
    MockedToolManager.callTool.mockResolvedValue("XML file written.");
    const chunks = [
      {
        content:
          "```xml\n<writeToFile><path>file.xml</path><content>xml content</content></writeToFile>\n```",
      },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: XML file written.\n",
    ]);
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "file.xml",
      content: "xml content",
    });
  });

  it("should handle a writeToFile block split across multiple chunks", async () => {
    MockedToolManager.callTool.mockResolvedValue("Split file written.");
    const chunks = [
      { content: "Here is a file <writeToFile><path>split.txt</path>" },
      { content: "<content>split content</content>" },
      { content: "</writeToFile> That was it." },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "Here is a file ",
      "Generating changes ...",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: Split file written.\n",
    ]);
    // Content after the block should be in buffer
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe(" That was it.");
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "split.txt",
      content: "split content",
    });
  });

  it("should handle multiple writeToFile blocks in the stream", async () => {
    MockedToolManager.callTool
      .mockResolvedValueOnce("File 1 written.")
      .mockResolvedValueOnce("File 2 written.");
    const chunks = [
      {
        content:
          "<writeToFile><path>f1.txt</path><content>c1</content></writeToFile>Some text<writeToFile><path>f2.txt</path><content>c2</content></writeToFile>",
      },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: File 1 written.\n",
      "Some text",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: File 2 written.\n",
    ]);
    expect(MockedToolManager.callTool).toHaveBeenCalledTimes(2);
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "f1.txt",
      content: "c1",
    });
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "f2.txt",
      content: "c2",
    });
  });

  it("should handle unclosed tags and show waiting message", async () => {
    const chunks = [
      { content: "Starting... <writeToFile><path>unclosed.txt</path>" },
      { content: "<content>this will not be closed" },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual(["Starting... ", "Generating changes ..."]);
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();

    // Unclosed content should be in buffer
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe("<writeToFile><path>unclosed.txt</path><content>this will not be closed");
  });

  it("should handle tags split across chunks including the tag name itself", async () => {
    MockedToolManager.callTool.mockResolvedValue("Tag split across chunks written.");
    const chunks = [
      { content: "Start <writeTo" },
      { content: "File><path>split.txt</path><content>split content</content></writeToFile> End" },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "Start ",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: Tag split across chunks written.\n",
    ]);
    // Content after the block should be in buffer
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe(" End");
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "split.txt",
      content: "split content",
    });
  });

  it("should handle non-string or empty content chunks", async () => {
    const chunks: any[] = [
      { content: "Hello" },
      { content: null },
      { content: "" },
      { content: " World" },
    ];
    const output = await processChunks(chunks);
    // With buffer queue, valid string chunks are buffered
    expect(output).toEqual([]);

    // Valid content should be in buffer
    const buffered = streamer.getBufferedChunks();
    expect(buffered).toBe("Hello World");
  });

  describe("Buffer Queue Functionality", () => {
    it("should buffer up to 5 chunks and yield when buffer is full", async () => {
      const chunks = [
        { content: "chunk1 " },
        { content: "chunk2 " },
        { content: "chunk3 " },
        { content: "chunk4 " },
        { content: "chunk5 " },
        { content: "chunk6 " },
        { content: "chunk7" },
      ];
      const output = await processChunks(chunks);
      // When buffer fills up (5 chunks), the first chunk should be yielded
      // Then as new chunks arrive, earlier chunks get yielded
      expect(output).toEqual(["chunk1 ", "chunk2 ", "chunk3 "]);

      // Remaining chunks should be in buffer
      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("chunk4 chunk5 chunk6 chunk7");
    });

    it("should handle partial tags that don't form complete writeToFile blocks", async () => {
      const chunks = [
        { content: "Hello " },
        { content: "world " },
        { content: "<write" },
        { content: " something " },
        { content: "else " },
        { content: "here" },
      ];
      const output = await processChunks(chunks);
      // Should yield chunks when buffer is full, since no complete tag is detected
      expect(output).toEqual(["Hello ", "world "]);

      // Remaining chunks should be in buffer
      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("<write something else here");
    });

    it("should handle mixed content with buffer queue and complete blocks", async () => {
      MockedToolManager.callTool.mockResolvedValue("Mixed content written.");
      const chunks = [
        { content: "start " },
        { content: "text " },
        { content: "<writeToFile><path>test.txt</path><content>test</content></writeToFile>" },
        { content: " more " },
        { content: "text" },
      ];
      const output = await processChunks(chunks);
      expect(output).toEqual([
        "start text ",
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: Mixed content written.\n",
      ]);

      // Content after the block should be in buffer
      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe(" more text");
    });

    it("should handle edge case where tag is split across the 5-chunk boundary", async () => {
      MockedToolManager.callTool.mockResolvedValue("Boundary split written.");
      const chunks = [
        { content: "1 " },
        { content: "2 " },
        { content: "3 " },
        { content: "4 " },
        { content: "<writeTo" }, // This makes buffer full, but starts a tag
        {
          content:
            "File><path>boundary.txt</path><content>boundary content</content></writeToFile>",
        },
      ];
      const output = await processChunks(chunks);
      // The buffer fills up with 5 chunks, so the first chunk "1 " gets yielded
      // Then when the final chunk arrives and completes the tag, "2 3 4 " gets yielded before processing the block
      expect(output).toEqual([
        "1 ",
        "2 3 4 ",
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: Boundary split written.\n",
      ]);

      // Should have no remaining buffer after processing the complete block
      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("");
    });
  });

  describe("End-of-Stream Buffer Handling", () => {
    it("should return remaining content in buffer after stream ends", async () => {
      const chunks = [{ content: "start " }, { content: "middle " }, { content: "end" }];
      await processChunks(chunks);

      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("start middle end");
    });

    it("should handle incomplete writeToFile block at end of stream", async () => {
      const chunks = [
        { content: "before " },
        { content: "<writeToFile><path>incomplete.txt</path>" },
        { content: "<content>never closed" },
      ];
      const output = await processChunks(chunks);

      // Should show generating message but not process the incomplete block
      expect(output).toEqual(["before ", "Generating changes ..."]);

      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("<writeToFile><path>incomplete.txt</path><content>never closed");
      expect(MockedToolManager.callTool).not.toHaveBeenCalled();
    });

    it("should handle mixed complete and incomplete blocks at end of stream", async () => {
      MockedToolManager.callTool.mockResolvedValue("First block processed.");
      const chunks = [
        { content: "<writeToFile><path>first.txt</path><content>first</content></writeToFile>" },
        { content: "between " },
        { content: "<writeToFile><path>second.txt</path>" },
        { content: "<content>incomplete second" },
      ];
      const output = await processChunks(chunks);

      expect(output).toEqual([
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: First block processed.\n",
        "between ",
        "Generating changes ...",
      ]);

      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("<writeToFile><path>second.txt</path><content>incomplete second");
      expect(MockedToolManager.callTool).toHaveBeenCalledTimes(1);
    });

    it("should handle realistic end-of-stream workflow", async () => {
      MockedToolManager.callTool.mockResolvedValue("Processed successfully.");
      const chunks = [
        { content: "Here's a complete file: " },
        {
          content:
            "<writeToFile><path>app.ts</path><content>console.log('hello');</content></writeToFile>",
        },
        { content: "\n\nAnd here's an incomplete one: " },
        { content: "<writeToFile><path>incomplete.ts</path><content>const x = " },
      ];

      // Process all chunks
      const output = await processChunks(chunks);

      expect(output).toEqual([
        "Here's a complete file: ",
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: Processed successfully.\n",
        "\n\nAnd here's an incomplete one: ",
        "Generating changes ...",
      ]);

      // Handle remaining buffered content (as shown in class documentation)
      const remaining = streamer.getBufferedChunks();
      expect(remaining).toBe("<writeToFile><path>incomplete.ts</path><content>const x = ");

      // In a real scenario, you might want to warn about incomplete content
      if (remaining.includes("<writeToFile>")) {
        // This would be handled by the calling code
        expect(remaining).toContain("<writeToFile>");
      }
    });
  });
});
