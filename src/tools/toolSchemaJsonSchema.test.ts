import type { App } from "obsidian";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

// Keep the import side effects light: the only thing we need from ApplyView is
// the view-type constant, and we don't want to pull the React component in.
jest.mock("@/components/composer/ApplyView", () => ({ APPLY_VIEW_TYPE: "apply-view" }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

import { createReadNoteTool } from "@/tools/NoteTools";
import { createWriteFileTool } from "@/tools/ComposerTools";

/**
 * Native tool calling (`bindTools`) serializes each tool's Zod schema to JSON
 * Schema via LangChain's `toJsonSchema`, which resolves the schema to its input
 * form. Zod refuses to represent transforms (e.g. `.preprocess`), throwing
 * "Transforms cannot be represented in JSON Schema" and failing the entire
 * model request. These guard against reintroducing a non-representable schema
 * on a built-in tool. Note: the classic `z.toJSONSchema` does NOT reproduce
 * this (it serializes the output type), so we use LangChain's converter here.
 */
describe("built-in tool schemas are JSON-Schema serializable", () => {
  const app = {} as App;

  it("readNote schema converts without throwing", () => {
    const tool = createReadNoteTool(app);
    expect(() => toJsonSchema(tool.schema)).not.toThrow();
  });

  it("writeFile schema converts without throwing", () => {
    const tool = createWriteFileTool(app);
    expect(() => toJsonSchema(tool.schema)).not.toThrow();
  });
});
