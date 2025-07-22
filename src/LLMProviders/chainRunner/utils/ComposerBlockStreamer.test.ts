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
    expect(output).toEqual(["Hello ", "world, this is ", "a test."]);
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
      " and some text after.",
    ]);
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
      " That was it.",
    ]);
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

  it("should handle an unclosed tag by showing a waiting message", async () => {
    const chunks = [
      { content: "Starting... <writeToFile><path>unclosed.txt</path>" },
      { content: "<content>this will not be closed" },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual(["Starting... ", "Generating changes ..."]);
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();
  });

  it("should handle an unclosed tag that gets closed in a later chunk", async () => {
    MockedToolManager.callTool.mockResolvedValue("Finally closed.");
    const chunks = [
      { content: "Start <writeToFile>" },
      { content: "<path>p</path><content>c</content>" },
      { content: "</writeToFile> End" },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "Start ",
      "Generating changes ...",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: Finally closed.\n",
      " End",
    ]);
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "p",
      content: "c",
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
    expect(output).toEqual(["Hello", " World"]);
  });

  it("should handle the literal <writeToFile> tag split across two chunks", async () => {
    MockedToolManager.callTool.mockResolvedValue("Tag split across chunks written.");
    const chunks = [
      { content: "Start <writeTo" },
      { content: "File><path>split.txt</path><content>split content</content></writeToFile> End" },
    ];
    const output = await processChunks(chunks);
    expect(output).toEqual([
      "Start ",
      "Generating changes ...",
      "\nWaiting users to accept or reject changes in the Preview UI ...\n",
      "File change result: Tag split across chunks written.\n",
      " End",
    ]);
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "split.txt",
      content: "split content",
    });
  });

  describe("Buffer Queue Functionality", () => {
    it("should buffer up to 5 chunks and yield the first when buffer is full with no tags", async () => {
      const chunks = [
        { content: "chunk1 " },
        { content: "chunk2 " },
        { content: "chunk3 " },
        { content: "chunk4 " },
        { content: "chunk5 " },
        { content: "chunk6" },
      ];
      const output = await processChunks(chunks);
      // When buffer fills up (5 chunks), the first chunk should be yielded
      // Then when chunk6 arrives, chunk2 should be yielded, etc.
      expect(output).toEqual(["chunk1 ", "chunk2 ", "chunk6"]);
    });

    it("should handle partial tag '<write' that doesn't form a complete tag", async () => {
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
      expect(output).toEqual(["Hello ", "world ", "<write", " something ", "here"]);
    });

    it("should handle partial tag '<writeToFile>' without closing tag", async () => {
      const chunks = [
        { content: "Start " },
        { content: "<writeToFile>" },
        { content: "no " },
        { content: "closing " },
        { content: "tag " },
        { content: "here" },
      ];
      const output = await processChunks(chunks);
      // Should detect unclosed tag and show generating message
      expect(output).toEqual(["Start ", "Generating changes ..."]);
    });

    it("should yield first chunk when buffer reaches 5 chunks with no complete blocks", async () => {
      const chunks = [
        { content: "text1 " },
        { content: "text2 " },
        { content: "text3 " },
        { content: "text4 " },
        { content: "text5 " },
      ];
      const output = await processChunks(chunks);
      // When buffer reaches exactly 5 chunks, should yield the first one
      expect(output).toEqual(["text1 "]);
    });

    it("should continue yielding first chunks as new chunks arrive", async () => {
      const chunks = [
        { content: "a " },
        { content: "b " },
        { content: "c " },
        { content: "d " },
        { content: "e " }, // Buffer full, should yield 'a '
        { content: "f " }, // Should yield 'b '
        { content: "g " }, // Should yield 'c '
      ];
      const output = await processChunks(chunks);
      expect(output).toEqual(["a ", "b ", "c "]);
    });

    it("should return buffered chunks via getBufferedChunks()", async () => {
      const chunks = [{ content: "buffer1 " }, { content: "buffer2 " }, { content: "buffer3" }];
      await processChunks(chunks);

      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("buffer1 buffer2 buffer3");
    });

    it("should return empty string from getBufferedChunks() when buffer is empty", async () => {
      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("");
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
        " more text",
      ]);
    });

    it("should handle buffer queue with xml-wrapped blocks", async () => {
      MockedToolManager.callTool.mockResolvedValue("XML with buffer written.");
      const chunks = [
        { content: "prefix " },
        { content: "```xml\n" },
        { content: "<writeToFile>" },
        { content: "<path>xml.txt</path>" },
        { content: "<content>xml content</content>" },
        { content: "</writeToFile>\n```" },
        { content: " suffix" },
      ];
      const output = await processChunks(chunks);
      expect(output).toEqual([
        "prefix ",
        "Generating changes ...",
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: XML with buffer written.\n",
        " suffix",
      ]);
    });

    it("should preserve content in buffer queue when encountering unclosed tags", async () => {
      const chunks = [
        { content: "before " },
        { content: "<writeToFile>" },
        { content: "incomplete" },
      ];
      await processChunks(chunks);

      const buffered = streamer.getBufferedChunks();
      expect(buffered).toBe("<writeToFile>incomplete");
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
      // Should detect the unclosed tag and not yield the first chunk
      expect(output).toEqual([
        "1 2 3 4 ",
        "Generating changes ...",
        "\nWaiting users to accept or reject changes in the Preview UI ...\n",
        "File change result: Boundary split written.\n",
      ]);
    });
  });
});
