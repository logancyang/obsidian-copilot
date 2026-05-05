// Lightweight mock for @anthropic-ai/claude-agent-sdk so unit tests can
// import modules that reference its runtime values (`query`,
// `createSdkMcpServer`, `tool`) without pulling the real ESM package
// through ts-jest. Tests that exercise SDK behavior should stub these.
/* eslint-disable no-undef */

function query() {
  // Minimal Query stub: empty async generator + control methods. Tests
  // that need real behavior should mock `query` themselves.
  const iter = (async function* () {})();
  return Object.assign(iter, {
    interrupt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    setMaxThinkingTokens: async () => {},
    applyFlagSettings: async () => {},
    initializationResult: async () => ({}),
    supportedCommands: async () => [],
    supportedModels: async () => [],
    supportedAgents: async () => [],
    mcpServerStatus: async () => [],
    getContextUsage: async () => ({}),
    readFile: async () => null,
    reloadPlugins: async () => ({}),
    accountInfo: async () => ({}),
  });
}

function createSdkMcpServer(options) {
  return { type: "sdk", instance: { name: options?.name ?? "mock", tools: options?.tools ?? [] } };
}

function tool(name, description, inputSchema, handler) {
  return { name, description, inputSchema, handler };
}

class AbortError extends Error {}

module.exports = {
  query,
  createSdkMcpServer,
  tool,
  AbortError,
};
