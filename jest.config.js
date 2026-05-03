module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/__mocks__/obsidian.js",
    "^@agentclientprotocol/sdk$": "<rootDir>/__mocks__/@agentclientprotocol/sdk.js",
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/__mocks__/@anthropic-ai/claude-agent-sdk.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
