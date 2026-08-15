import baseConfig from "./eslint.config.mjs";
import typescriptParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import { PlainTextParser } from "eslint-plugin-obsidianmd/dist/lib/plainTextParser.js";

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
      // Reproduces the scorecard's deprecation findings locally, so a dependency
      // bump cannot reintroduce them unnoticed. Promote to "error" once the
      // remaining families outside this gate's scope are cleared.
      "@typescript-eslint/no-deprecated": "warn",
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
    files: ["**/*manifest.json"],
    languageOptions: {
      parser: typescriptParser,
    },
    plugins: { obsidianmd },
    rules: {
      // The upstream rule combines schema failures with copy guidance. The
      // package gate promotes only its schema findings to blocking errors.
      "obsidianmd/validate-manifest": "warn",
    },
  },
  {
    files: ["**/*LICENSE"],
    // eslint-plugin-obsidianmd does not yet export a flat config for LICENSE,
    // so use the plain-text parser bundled with the pinned plugin version.
    languageOptions: {
      parser: PlainTextParser,
    },
    plugins: { obsidianmd },
    rules: {
      "obsidianmd/validate-license": "warn",
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
