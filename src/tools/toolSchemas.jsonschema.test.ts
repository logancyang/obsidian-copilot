import type { App } from "obsidian";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { createReadNoteTool } from "./NoteTools";
import { createWriteFileTool, createEditFileTool } from "./ComposerTools";

const mockApp = {} as unknown as App;

describe("toolSchemas", () => {
  describe("createReadNoteTool()", () => {
    it("produces a schema that LangChain serializes to JSON Schema for tool binding", () => {
      expect(() => toJsonSchema(createReadNoteTool(mockApp).schema)).not.toThrow();
    });
  });

  describe("createWriteFileTool()", () => {
    it("produces a schema that LangChain serializes to JSON Schema for tool binding", () => {
      expect(() => toJsonSchema(createWriteFileTool(mockApp).schema)).not.toThrow();
    });

    it("keeps arbitrary object content intact when parsing arguments", () => {
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

  describe("createEditFileTool()", () => {
    it("produces a schema that LangChain serializes to JSON Schema for tool binding", () => {
      expect(() => toJsonSchema(createEditFileTool(mockApp).schema)).not.toThrow();
    });
  });
});
