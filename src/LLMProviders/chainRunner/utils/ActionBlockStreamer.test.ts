import { ActionBlockStreamer } from "./ActionBlockStreamer";
import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";

// Mock the ToolManager and ToolResultFormatter
jest.mock("@/tools/toolManager");
jest.mock("@/tools/ToolResultFormatter");

const MockedToolManager = ToolManager as jest.Mocked<typeof ToolManager>;
const MockedToolResultFormatter = ToolResultFormatter as jest.Mocked<typeof ToolResultFormatter>;

describe("ActionBlockStreamer", () => {
  let writeFileTool: any;
  let streamer: ActionBlockStreamer;

  beforeEach(() => {
    writeFileTool = { name: "writeFile" };
    MockedToolManager.callTool.mockClear();

    // Mock ToolResultFormatter to return the raw result without "File change result: " prefix
    MockedToolResultFormatter.format = jest.fn((_toolName, result) => result);

    streamer = new ActionBlockStreamer(MockedToolManager, writeFileTool);
  });

  // Helper function to process chunks and collect results
  async function processChunks(chunks: { content: string | null }[]): Promise<any[]> {
    const outputContents: any[] = [];
    for (const chunk of chunks) {
      for await (const result of streamer.processChunk(chunk)) {
        // Always push the content, even if it's null, undefined, or empty string
        outputContents.push(result.content);
      }
    }
    return outputContents;
  }

  it("should pass through chunks without writeFile tags unchanged", async () => {
    const chunks = [{ content: "Hello " }, { content: "world, this is " }, { content: "a test." }];
    const output = await processChunks(chunks);

    // All chunks should be yielded as-is
    expect(output).toEqual(["Hello ", "world, this is ", "a test."]);

    // No tool calls should be made
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();
  });

  it("should handle a complete writeFile block in a single chunk", async () => {
    MockedToolManager.callTool.mockResolvedValue("File written successfully.");
    const chunks = [
      {
        content:
          "Some text before <writeFile><path>file.txt</path><content>content</content></writeFile> and some text after.",
      },
    ];
    const output = await processChunks(chunks);

    // Should yield original chunk plus tool result
    expect(output).toEqual([
      "Some text before <writeFile><path>file.txt</path><content>content</content></writeFile> and some text after.",
      "\nFile written successfully.\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "file.txt",
      content: "content",
    });
  });

  it("should handle a complete xml-wrapped writeFile block", async () => {
    MockedToolManager.callTool.mockResolvedValue("XML file written.");
    const chunks = [
      {
        content:
          "```xml\n<writeFile><path>file.xml</path><content>xml content</content></writeFile>\n```",
      },
    ];
    const output = await processChunks(chunks);

    expect(output).toEqual([
      "```xml\n<writeFile><path>file.xml</path><content>xml content</content></writeFile>\n```",
      "\nXML file written.\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "file.xml",
      content: "xml content",
    });
  });

  it("should handle a writeFile block split across multiple chunks", async () => {
    MockedToolManager.callTool.mockResolvedValue("Split file written.");
    const chunks = [
      { content: "Here is a file <writeFile><path>split.txt</path>" },
      { content: "<content>split content</content>" },
      { content: "</writeFile> That was it." },
    ];
    const output = await processChunks(chunks);

    // All chunks should be yielded as-is, plus tool result when complete block is detected
    expect(output).toEqual([
      "Here is a file <writeFile><path>split.txt</path>",
      "<content>split content</content>",
      "</writeFile> That was it.",
      "\nSplit file written.\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "split.txt",
      content: "split content",
    });
  });

  it("should handle multiple writeFile blocks in the stream", async () => {
    MockedToolManager.callTool
      .mockResolvedValueOnce("File 1 written.")
      .mockResolvedValueOnce("File 2 written.");
    const chunks = [
      {
        content:
          "<writeFile><path>f1.txt</path><content>c1</content></writeFile>Some text<writeFile><path>f2.txt</path><content>c2</content></writeFile>",
      },
    ];
    const output = await processChunks(chunks);

    // Should yield original chunk plus both tool results
    expect(output).toEqual([
      "<writeFile><path>f1.txt</path><content>c1</content></writeFile>Some text<writeFile><path>f2.txt</path><content>c2</content></writeFile>",
      "\nFile 1 written.\n",
      "\nFile 2 written.\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledTimes(2);
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "f1.txt",
      content: "c1",
    });
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "f2.txt",
      content: "c2",
    });
  });

  it("should handle unclosed tags without calling tools", async () => {
    const chunks = [
      { content: "Starting... <writeFile><path>unclosed.txt</path>" },
      { content: "<content>this will not be closed" },
    ];
    const output = await processChunks(chunks);

    // Should yield all chunks as-is
    expect(output).toEqual([
      "Starting... <writeFile><path>unclosed.txt</path>",
      "<content>this will not be closed",
    ]);

    // No tool calls should be made for incomplete blocks
    expect(MockedToolManager.callTool).not.toHaveBeenCalled();
  });

  it("should handle tool call errors gracefully", async () => {
    MockedToolManager.callTool.mockRejectedValue(new Error("Tool error"));
    const chunks = [
      {
        content: "<writeFile><path>error.txt</path><content>content</content></writeFile>",
      },
    ];
    const output = await processChunks(chunks);

    expect(output).toEqual([
      "<writeFile><path>error.txt</path><content>content</content></writeFile>",
      "\nError: Tool error\n",
    ]);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "error.txt",
      content: "content",
    });
  });

  it("should handle chunks with different content types", async () => {
    const chunks: { content: string | null }[] = [
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
          "<writeFile><path>  spaced.txt  </path><content>  content with spaces  </content></writeFile>",
      },
    ];
    await processChunks(chunks);

    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "spaced.txt",
      content: "content with spaces",
    });
  });

  it("should handle malformed blocks gracefully", async () => {
    MockedToolManager.callTool.mockResolvedValue("Malformed handled.");
    const chunks = [
      {
        content: "<writeFile><path>missing-content.txt</path></writeFile>",
      },
    ];
    const output = await processChunks(chunks);

    // Should yield chunk as-is plus tool result
    expect(output).toEqual([
      "<writeFile><path>missing-content.txt</path></writeFile>",
      "\nMalformed handled.\n",
    ]);

    // Tool should be called with undefined content
    expect(MockedToolManager.callTool).toHaveBeenCalledWith(writeFileTool, {
      path: "missing-content.txt",
      content: undefined,
    });
  });
});
