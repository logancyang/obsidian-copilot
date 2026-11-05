import type { App } from "obsidian";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { createReadNoteTool } from "./NoteTools";

const mockApp = {} as unknown as App;

describe("toolSchemas", () => {
  describe("createReadNoteTool()", () => {
    it("produces a schema that LangChain serializes to JSON Schema for tool binding", () => {
      expect(() => toJsonSchema(createReadNoteTool(mockApp).schema)).not.toThrow();
    });
  });
});
