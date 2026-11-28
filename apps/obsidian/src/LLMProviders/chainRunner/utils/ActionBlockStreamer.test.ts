import { ToolManager } from "@/tools/toolManager";
import { ActionBlockStreamer } from "./ActionBlockStreamer";

describe("ActionBlockStreamer", () => {
  describe("processChunk()", () => {
    let writeFileCall: jest.Mock;
    let streamer: ActionBlockStreamer;

    beforeEach(() => {
      writeFileCall = jest.fn();
      streamer = new ActionBlockStreamer(ToolManager, { name: "writeFile", call: writeFileCall });
    });

    async function processChunks(chunks: { content: string | null }[]): Promise<unknown[]> {
      const outputContents: unknown[] = [];
      for (const chunk of chunks) {
        for await (const result of streamer.processChunk(chunk)) {
          outputContents.push(result.content);
        }
      }
      return outputContents;
    }

    it("passes chunks without writeFile tags through unchanged and calls no tool", async () => {
      const output = await processChunks([
        { content: "Hello " },
        { content: "world, this is " },
        { content: "a test." },
      ]);

      expect(output).toEqual(["Hello ", "world, this is ", "a test."]);
      expect(writeFileCall).not.toHaveBeenCalled();
    });

    it("runs writeFile for a complete block in one chunk and yields the result after the chunk", async () => {
      writeFileCall.mockResolvedValue("File written successfully.");
      const content =
        "Some text before <writeFile><path>file.txt</path><content>content</content></writeFile> and some text after.";

      const output = await processChunks([{ content }]);

      expect(output).toEqual([content, "\nFile written successfully.\n"]);
      expect(writeFileCall).toHaveBeenCalledWith({ path: "file.txt", content: "content" });
    });

    it("runs writeFile for a block wrapped in a code fence", async () => {
      writeFileCall.mockResolvedValue("XML file written.");
      const content =
        "```xml\n<writeFile><path>file.xml</path><content>xml content</content></writeFile>\n```";

      const output = await processChunks([{ content }]);

      expect(output).toEqual([content, "\nXML file written.\n"]);
      expect(writeFileCall).toHaveBeenCalledWith({ path: "file.xml", content: "xml content" });
    });

    it("runs writeFile once the closing tag arrives in a later chunk", async () => {
      writeFileCall.mockResolvedValue("Split file written.");

      const output = await processChunks([
        { content: "Here is a file <writeFile><path>split.txt</path>" },
        { content: "<content>split content</content>" },
        { content: "</writeFile> That was it." },
      ]);

      expect(output).toEqual([
        "Here is a file <writeFile><path>split.txt</path>",
        "<content>split content</content>",
        "</writeFile> That was it.",
        "\nSplit file written.\n",
      ]);
      expect(writeFileCall).toHaveBeenCalledTimes(1);
      expect(writeFileCall).toHaveBeenCalledWith({ path: "split.txt", content: "split content" });
    });

    it("runs writeFile once per block, in order, when one chunk holds several blocks", async () => {
      writeFileCall
        .mockResolvedValueOnce("File 1 written.")
        .mockResolvedValueOnce("File 2 written.");
      const content =
        "<writeFile><path>f1.txt</path><content>c1</content></writeFile>Some text<writeFile><path>f2.txt</path><content>c2</content></writeFile>";

      const output = await processChunks([{ content }]);

      expect(output).toEqual([content, "\nFile 1 written.\n", "\nFile 2 written.\n"]);
      expect(writeFileCall.mock.calls).toEqual([
        [{ path: "f1.txt", content: "c1" }],
        [{ path: "f2.txt", content: "c2" }],
      ]);
    });

    it("yields the formatted status when the tool reports that the file change was accepted", async () => {
      writeFileCall.mockResolvedValue(JSON.stringify({ result: "accepted" }));

      const output = await processChunks([
        { content: "<writeFile><path>a.md</path><content>x</content></writeFile>" },
      ]);

      expect(output[1]).toBe("\n✅ File change: accepted\n");
    });

    it("trims whitespace around the path and content", async () => {
      writeFileCall.mockResolvedValue("ok");

      await processChunks([
        {
          content:
            "<writeFile><path>  spaced.txt  </path><content>  content with spaces  </content></writeFile>",
        },
      ]);

      expect(writeFileCall).toHaveBeenCalledWith({
        path: "spaced.txt",
        content: "content with spaces",
      });
    });

    it("passes through null and empty chunk content unchanged", async () => {
      const output = await processChunks([
        { content: "Hello" },
        { content: null },
        { content: "" },
        { content: " World" },
      ]);

      expect(output).toEqual(["Hello", null, "", " World"]);
    });

    it("calls writeFile with undefined content when the block has no content tag", async () => {
      writeFileCall.mockResolvedValue("Malformed handled.");
      const content = "<writeFile><path>missing-content.txt</path></writeFile>";

      const output = await processChunks([{ content }]);

      expect(output).toEqual([content, "\nMalformed handled.\n"]);
      expect(writeFileCall).toHaveBeenCalledWith({
        path: "missing-content.txt",
        content: undefined,
      });
    });

    it("calls no tool while a block stays unclosed", async () => {
      const output = await processChunks([
        { content: "Starting... <writeFile><path>unclosed.txt</path>" },
        { content: "<content>this will not be closed" },
      ]);

      expect(output).toEqual([
        "Starting... <writeFile><path>unclosed.txt</path>",
        "<content>this will not be closed",
      ]);
      expect(writeFileCall).not.toHaveBeenCalled();
    });

    it("yields the tool's error message instead of throwing when writeFile fails", async () => {
      writeFileCall.mockRejectedValue(new Error("Tool error"));
      const content = "<writeFile><path>error.txt</path><content>content</content></writeFile>";

      const output = await processChunks([{ content }]);

      expect(output).toEqual([content, "\nError: Tool error\n"]);
    });
  });
});
