// The MCP SDK client imports Ajv only to check tool results against their output schemas, which Copilot never asks it to do, and Ajv adds about 240 KB to main.js.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
const mcpAjvStub = {
  name: "mcp-ajv-stub",
  setup(build) {
    build.onResolve({ filter: /\/validation\/ajv-provider\.js$/ }, (args) =>
      args.importer.includes("@modelcontextprotocol/sdk")
        ? { path: args.path, namespace: "mcp-ajv-stub" }
        : undefined
    );

    build.onLoad({ filter: /.*/, namespace: "mcp-ajv-stub" }, () => ({
      contents: `
export class AjvJsonSchemaValidator {
  getValidator() {
    return (input) => ({ valid: true, data: input, errorMessage: undefined });
  }
}
`,
      loader: "js",
    }));
  },
};

export default mcpAjvStub;
