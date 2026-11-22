function query() {
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
