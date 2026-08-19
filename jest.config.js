module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/dev"],
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
    // @orama/orama resolves to its ESM "browser" entry under jsdom, which Jest
    // can't parse; point at the CJS build it ships under dist/commonjs/ (same
    // reason as yaml above).
    "^@orama/orama$": "<rootDir>/node_modules/@orama/orama/dist/commonjs/index.js",
    // @anthropic-ai/sdk publishes its lib/ entry points through an "exports"
    // wildcard that Jest's resolver does not expand, so @langchain/anthropic's
    // require of one fails to resolve. Point at the CJS build directly.
    "^@anthropic-ai/sdk/lib/(.*)$": "<rootDir>/node_modules/@anthropic-ai/sdk/lib/$1.js",
    "^@agentclientprotocol/sdk$": "<rootDir>/__mocks__/@agentclientprotocol/sdk.js",
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/__mocks__/@anthropic-ai/claude-agent-sdk.js",
    // react-resizable-panels is ESM-only with no CJS build to point at; stub it.
    "^react-resizable-panels$": "<rootDir>/__mocks__/react-resizable-panels.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
