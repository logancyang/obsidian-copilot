module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/__mocks__/svg.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/__mocks__/obsidian.js",
    // The yaml package's "exports" field defaults to a browser ESM entry under
    // jsdom; Jest can't parse ESM without extra config, so point at the CJS
    // build it ships under dist/.
    "^yaml$": "<rootDir>/node_modules/yaml/dist/index.js",
    "^@agentclientprotocol/sdk$": "<rootDir>/__mocks__/@agentclientprotocol/sdk.js",
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/__mocks__/@anthropic-ai/claude-agent-sdk.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
