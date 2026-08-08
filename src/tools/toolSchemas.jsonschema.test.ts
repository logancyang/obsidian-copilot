import type { App } from "obsidian";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { createReadNoteTool } from "./NoteTools";
import { createWriteFileTool, createEditFileTool } from "./ComposerTools";

/**
 * Regression guard for the "Transforms cannot be represented in JSON Schema" failure.
 *
 * When the autonomous agent binds tools, LangChain serializes each tool's zod schema for
 * the model request via `toJsonSchema()`. LangChain first rewrites the schema to its INPUT
 * form (`interopZodTransformInputSchema`) and then runs zod v4's `toJSONSchema()`; a
 * schema-level `.transform()` / `.preprocess()` left in that input form has no JSON Schema
 * representation and throws at request time (surfaced as "Model request failed: ...").
 *
 * `readNote.chunkIndex` previously used `.preprocess()` and broke the agent this way.
 * Note: the throw only reproduces through LangChain's `toJsonSchema` path, not a bare
 * `z.toJSONSchema(schema)` — the rewrite step is what exposes the transform.
 *
 * Scoped to these factories rather than the full ToolRegistry because pulling in
 * builtinTools transitively imports chatModelManager / @langchain/anthropic, which fails to
 * resolve under jest.
 */

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
});
