import type { App } from "obsidian";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { createReadNoteTool } from "./NoteTools";
import { createWriteFileTool, createEditFileTool } from "./ComposerTools";

const mockApp = {} as unknown as App;

const toolFactories = [
  { name: "readNote", create: createReadNoteTool },
  { name: "writeFile", create: createWriteFileTool },
  { name: "editFile", create: createEditFileTool },
];

describe("tool schemas are JSON-Schema serializable for tool binding", () => {
  test.each(toolFactories)(
    "$name schema serializes via LangChain toJsonSchema without throwing",
    ({ create }) => {
      const tool = create(mockApp);
      expect(() => toJsonSchema(tool.schema)).not.toThrow();
    }
  );

  describe("createWriteFileTool()", () => {
    it("preserves arbitrary object content", () => {
      const tool = createWriteFileTool(mockApp);
      const content = {
        nodes: [{ id: "node-1", type: "text", text: "Hello" }],
        metadata: { custom: true },
      };

      expect(tool.schema.parse({ path: "canvas/example.canvas", content })).toEqual({
        path: "canvas/example.canvas",
        content,
      });
    });
  });
});
