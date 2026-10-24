module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  ...(process.env.COPILOT_JEST_MAX_WORKERS && { maxWorkers: process.env.COPILOT_JEST_MAX_WORKERS }),
  roots: ["<rootDir>/src", "<rootDir>/dev", "<rootDir>/scripts"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/__mocks__/svg.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/__mocks__/obsidian.js",
    "^yaml$": "<rootDir>/node_modules/yaml/dist/index.js",
    "^@anthropic-ai/sdk/lib/(.*)$": "<rootDir>/node_modules/@anthropic-ai/sdk/lib/$1.js",
    "^@agentclientprotocol/sdk$": "<rootDir>/__mocks__/@agentclientprotocol/sdk.js",
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/__mocks__/@anthropic-ai/claude-agent-sdk.js",
    "^react-resizable-panels$": "<rootDir>/__mocks__/react-resizable-panels.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
