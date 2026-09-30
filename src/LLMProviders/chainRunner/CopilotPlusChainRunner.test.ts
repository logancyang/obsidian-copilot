import { CopilotPlusChainRunner } from "@/LLMProviders/chainRunner/CopilotPlusChainRunner";
import { ToolManager } from "@/tools/toolManager";
import type { StructuredTool } from "@langchain/core/tools";

jest.mock("@/logger");
jest.mock("@/LLMProviders/chainOwner", () => ({ __esModule: true, default: {} }));
jest.mock("@/tools/builtinTools", () => ({ initializeBuiltinTools: jest.fn() }));
jest.mock("@/tools/SearchTools", () => ({
  createLocalSearchTool: jest.fn(),
  webSearchTool: {},
}));
jest.mock("@/tools/ComposerTools", () => ({ createWriteFileTool: jest.fn() }));
jest.mock("@/tools/memoryTools", () => ({ createUpdateMemoryTool: jest.fn() }));
jest.mock("@/tools/toolManager", () => ({ ToolManager: { callTool: jest.fn() } }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false })),
}));

type ToolCall = { tool: StructuredTool; args: Record<string, unknown> };

function executeToolCalls(toolCalls: ToolCall[]) {
  const runner = new CopilotPlusChainRunner({} as never) as unknown as {
    executeToolCalls: (calls: ToolCall[]) => Promise<{
      toolOutputs: { tool: string; output: unknown }[];
      sources: unknown[];
    }>;
  };
  return runner.executeToolCalls(toolCalls);
}

function extractEmbeddedImages(
  content: string,
  sourcePath: string | undefined,
  vaultFiles: Record<string, string> = {}
) {
  const getFirstLinkpathDest = jest.fn((linkpath: string) =>
    linkpath in vaultFiles ? { path: vaultFiles[linkpath] } : null
  );
  const runner = new CopilotPlusChainRunner({
    app: { metadataCache: { getFirstLinkpathDest } },
  } as never) as unknown as {
    extractEmbeddedImages: (content: string, sourcePath?: string) => Promise<string[]>;
  };
  return runner
    .extractEmbeddedImages(content, sourcePath)
    .then((images) => ({ images, getFirstLinkpathDest }));
}

describe("CopilotPlusChainRunner", () => {
  describe("executeToolCalls()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("turns a thrown localSearch error into a failed search the model can explain (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      (ToolManager.callTool as jest.Mock).mockRejectedValue(
        new Error("Miyo is unavailable. Open Miyo, then retry vault search.")
      );

      const { toolOutputs } = await executeToolCalls([
        { tool: { name: "localSearch" } as StructuredTool, args: { query: "notes" } },
      ]);

      expect(toolOutputs).toEqual([
        {
          tool: "localSearch",
          output:
            "<localSearch>\nSearch failed: Miyo is unavailable. Open Miyo, then retry vault search.\n</localSearch>",
        },
      ]);
    });

    it("propagates a thrown error from any other tool", async () => {
      (ToolManager.callTool as jest.Mock).mockRejectedValue(new Error("web search down"));

      await expect(
        executeToolCalls([{ tool: { name: "webSearch" } as StructuredTool, args: {} }])
      ).rejects.toThrow("web search down");
    });
  });

  describe("extractEmbeddedImages()", () => {
    const NOTE = "notes/test.md";

    it("resolves wiki embeds and markdown images to vault paths through the source note", async () => {
      const { images, getFirstLinkpathDest } = await extractEmbeddedImages(
        "![[screenshot.png]] and ![alt](diagram.jpg)",
        NOTE,
        { "screenshot.png": "attachments/screenshot.png", "diagram.jpg": "images/diagram.jpg" }
      );

      expect(images).toEqual(["attachments/screenshot.png", "images/diagram.jpg"]);
      expect(getFirstLinkpathDest).toHaveBeenCalledWith("screenshot.png", NOTE);
      expect(getFirstLinkpathDest).toHaveBeenCalledWith("diagram.jpg", NOTE);
    });

    it("lists every wiki embed before the markdown images", async () => {
      const { images } = await extractEmbeddedImages(
        "![](second.jpg) ![[first.png]] ![alt](fourth.svg) ![[third.gif]]",
        NOTE
      );

      expect(images).toEqual(["first.png", "third.gif", "second.jpg", "fourth.svg"]);
    });

    it("keeps the written name when an image cannot be resolved", async () => {
      const { images } = await extractEmbeddedImages("![[missing.png]] ![](gone.jpg)", NOTE);

      expect(images).toEqual(["missing.png", "gone.jpg"]);
    });

    it("strips a leading ./ or / from markdown paths before resolving them", async () => {
      const { images, getFirstLinkpathDest } = await extractEmbeddedImages(
        "![](./images/test.png) ![](/images/absolute.png)",
        NOTE,
        { "images/test.png": "vault/images/test.png" }
      );

      expect(images).toEqual(["vault/images/test.png", "images/absolute.png"]);
      expect(getFirstLinkpathDest).toHaveBeenCalledWith("images/test.png", NOTE);
      expect(getFirstLinkpathDest).toHaveBeenCalledWith("images/absolute.png", NOTE);
    });

    it("returns external image URLs without resolving them", async () => {
      const { images, getFirstLinkpathDest } = await extractEmbeddedImages(
        "![](https://example.com/image.png) ![](http://site.com/pic.jpg)",
        NOTE
      );

      expect(images).toEqual(["https://example.com/image.png", "http://site.com/pic.jpg"]);
      expect(getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("returns names as written without resolving when there is no source note", async () => {
      const { images, getFirstLinkpathDest } = await extractEmbeddedImages(
        "![[test.png]] ![](./other.jpg)",
        undefined
      );

      expect(images).toEqual(["test.png", "other.jpg"]);
      expect(getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("ignores a wiki embed that is not an image file", async () => {
      const { images } = await extractEmbeddedImages("![[document.pdf]]", NOTE);

      expect(images).toEqual([]);
    });

    it("returns an empty list for content without images", async () => {
      const { images } = await extractEmbeddedImages("Just text with no images", NOTE);

      expect(images).toEqual([]);
    });
  });
});
