module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  ...(process.env.COPILOT_JEST_MAX_WORKERS && { maxWorkers: process.env.COPILOT_JEST_MAX_WORKERS }),
  roots: [
    "<rootDir>/apps/obsidian/src",
    "<rootDir>/packages",
    "<rootDir>/dev",
    "<rootDir>/scripts",
  ],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/apps/obsidian/__mocks__/svg.js",
    "^@/(.*)$": "<rootDir>/apps/obsidian/src/$1",
    "^@copilot/(core|protocol|client)/(.*)$": "<rootDir>/packages/$1/src/$2",
    "^obsidian$": "<rootDir>/apps/obsidian/__mocks__/obsidian.js",
    "^yaml$": "<rootDir>/node_modules/yaml/dist/index.js",
    "^pkce-challenge$": "<rootDir>/node_modules/pkce-challenge/dist/index.node.cjs",
    "^@anthropic-ai/sdk/lib/(.*)$": "<rootDir>/node_modules/@anthropic-ai/sdk/lib/$1.js",
    "^@agentclientprotocol/sdk$": "<rootDir>/apps/obsidian/__mocks__/@agentclientprotocol/sdk.js",
    "^@anthropic-ai/claude-agent-sdk$":
      "<rootDir>/apps/obsidian/__mocks__/@anthropic-ai/claude-agent-sdk.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
