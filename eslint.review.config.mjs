import baseConfig from "./eslint.config.mjs";

const sourceFiles = ["src/**/*.{ts,tsx}", "dev/gallery/**/*.{ts,tsx}"];

export default [
  ...baseConfig,
  {
    ignores: [
      "**/*.test.{js,jsx,ts,tsx}",
      "**/__mocks__/**",
      "src/integration_tests/**",
      "dev/gallery/esbuild.config.mjs",
    ],
  },
  {
    files: sourceFiles,
    rules: {
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: true }],
      "no-restricted-globals": [
        "warn",
        {
          name: "app",
          message:
            "Don't use the global `app` (footgun in popouts). Thread `app` via useApp() or a parameter. See designdocs/agents/PLUGIN_DEV_GUIDE.md.",
        },
        {
          name: "fetch",
          message:
            "Use Obsidian requestUrl instead of fetch unless a reviewed streaming adapter requires fetch.",
        },
      ],
    },
  },
  {
    files: ["src/logger.ts"],
    rules: {
      "obsidianmd/rule-custom-message": [
        "warn",
        {
          "no-console": {
            messages: {
              "Unexpected console statement. Only these console methods are allowed: warn, error, debug.":
                "Avoid unnecessary logging to console. See https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+unnecessary+logging+to+console",
            },
            options: [{ allow: ["warn", "error", "debug"] }],
          },
        },
      ],
    },
  },
];
