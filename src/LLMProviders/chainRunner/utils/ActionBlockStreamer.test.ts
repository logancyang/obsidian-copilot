import { ActionBlockStreamer } from "./ActionBlockStreamer";
import { ToolManager } from "@/tools/toolManager";

// Mock the ToolManager
jest.mock("@/tools/toolManager");

const MockedToolManager = ToolManager as jest.Mocked<typeof ToolManager>;

describe("ActionBlockStreamer", () => {
  let writeToFileTool: any;
  let streamer: ActionBlockStreamer;

  beforeEach(() => {
    writeToFileTool = { name: "writeToFile" };
    MockedToolManager.callTool.mockClear();
    streamer = new ActionBlockStreamer(MockedToolManager, writeToFileTool);
  });

  // Helper function to process chunks and collect results
  async function processChunks(chunks: { content: string | null }[]) {
    const outputContents: any[] = [];
    for (const chunk of chunks) {
      for await (const result of streamer.processChunk(chunk)) {
        // Always push the content, even if it's null, undefined, or empty string
        outputContents.push(result.content);
      }
    }
    return outputContents;
  }

  it("should pass through chunks without writeToFile tags unchanged", async () => {
    const chunks = [{ content: "Hello " }, { content: "world, this is " }, { content: "a test." }];
    const output = await processChunks(chunks);

    // All chunks should be yielded as-is
    expect(output).toEqual(["Hello ", "world, this is ", "a test."]);

    // No tool calls should be made
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();
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

    // Should yield original chunk plus tool result
    expect(output).toEqual([
      "Some text before <writeToFile><path>file.txt</path><content>content</content></writeToFile> and some text after.",
      "\nFile change result: File written successfully.\n",
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
      "```xml\n<writeToFile><path>file.xml</path><content>xml content</content></writeToFile>\n```",
      "\nFile change result: XML file written.\n",
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

    // All chunks should be yielded as-is, plus tool result when complete block is detected
    expect(output).toEqual([
      "Here is a file <writeToFile><path>split.txt</path>",
      "<content>split content</content>",
      "</writeToFile> That was it.",
      "\nFile change result: Split file written.\n",
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

    // Should yield original chunk plus both tool results
    expect(output).toEqual([
      "<writeToFile><path>f1.txt</path><content>c1</content></writeToFile>Some text<writeToFile><path>f2.txt</path><content>c2</content></writeToFile>",
      "\nFile change result: File 1 written.\n",
      "\nFile change result: File 2 written.\n",
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

  it("should handle unclosed tags without calling tools", async () => {
    const chunks = [
      { content: "Starting... <writeToFile><path>unclosed.txt</path>" },
      { content: "<content>this will not be closed" },
    ];
    const output = await processChunks(chunks);

    // Should yield all chunks as-is
    expect(output).toEqual([
      "Starting... <writeToFile><path>unclosed.txt</path>",
      "<content>this will not be closed",
    ]);

    // No tool calls should be made for incomplete blocks
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();
  });

  it("should handle tool call errors gracefully", async () => {
    MockedToolManager.callTool.mockRejectedValue(new Error("Tool error"));
    const chunks = [
      {
        content: "<writeToFile><path>error.txt</path><content>content</content></writeToFile>",
      },
    ];
    const output = await processChunks(chunks);

    expect(output).toEqual([
      "<writeToFile><path>error.txt</path><content>content</content></writeToFile>",
      "\nError: Tool error\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "error.txt",
      content: "content",
    });
  });

  it("should handle chunks with different content types", async () => {
    const chunks: any[] = [
      { content: "Hello" },
      { content: null },
      { content: "" },
      { content: " World" },
    ];
    const output = await processChunks(chunks);

    // Should yield all chunks as-is, null content is yielded but not added to buffer
    expect(output).toEqual(["Hello", null, "", " World"]);
  });

  it("should handle whitespace in path and content", async () => {
    MockedToolManager.callTool.mockResolvedValue("Whitespace handled.");
    const chunks = [
      {
        content:
          "<writeToFile><path>  spaced.txt  </path><content>  content with spaces  </content></writeToFile>",
      },
    ];
    await processChunks(chunks);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "spaced.txt",
      content: "content with spaces",
    });
  });

  it("should handle malformed blocks gracefully", async () => {
    MockedToolManager.callTool.mockResolvedValue("Malformed handled.");
    const chunks = [
      {
        content: "<writeToFile><path>missing-content.txt</path></writeToFile>",
      },
    ];
    const output = await processChunks(chunks);

    // Should yield chunk as-is plus tool result
    expect(output).toEqual([
      "<writeToFile><path>missing-content.txt</path></writeToFile>",
      "\nFile change result: Malformed handled.\n",
    ]);

    // Tool should be called with undefined content
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeToFileTool, {
      path: "missing-content.txt",
      content: undefined,
    });
  });
});
