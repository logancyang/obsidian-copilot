import obsidianmd from "eslint-plugin-obsidianmd";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tailwind from "eslint-plugin-tailwindcss";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "styles.css",
      "data.json",
      "designdocs/**",
      "docs/**",
    ],
  },

  // obsidianmd recommended brings:
  //   - eslint:recommended
  //   - typescript-eslint recommendedTypeChecked on .ts/.tsx (recommended on .js/.jsx)
  //   - obsidianmd plugin + all obsidianmd-namespaced rules
  //   - import / @microsoft/sdl / depend / no-unsanitized
  //   - Obsidian-injected globals (activeDocument, createDiv, etc.)
  ...obsidianmd.configs.recommended,

  // React + tailwind plugins ship flat configs with no `files` filter, so
  // they'd cascade onto package.json (which uses the JSON parser) and crash.
  // Constrain them to JS/TS sources.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ...reactPlugin.configs.flat.recommended,
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  ...tailwind.configs["flat/recommended"].map((cfg) => ({
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ...cfg,
  })),

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        // Obsidian plugin runtime injects `app` as a global (see CLAUDE.md).
        app: "readonly",
      },
    },
    settings: {
      react: { version: "detect" },
      tailwindcss: {
        callees: ["classnames", "clsx", "ctl", "cn", "cva"],
        config: "./tailwind.config.js",
        cssFiles: ["**/*.css", "!**/node_modules", "!**/.*", "!**/dist", "!**/build"],
      },
    },
    rules: {
      // Carry-over from legacy .eslintrc
      "no-prototype-builtins": "off",
      "react/prop-types": "off",
      "tailwindcss/classnames-order": "error",
      "tailwindcss/enforces-negative-arbitrary-values": "error",
      "tailwindcss/enforces-shorthand": "error",
      "tailwindcss/migration-from-tailwind-2": "error",
      "tailwindcss/no-arbitrary-value": "off",
      "tailwindcss/no-custom-classname": "error",
      "tailwindcss/no-contradicting-classname": "error",

      // obsidianmd: defer to follow-up PRs
      "obsidianmd/ui/sentence-case": "off",

      // obsidianmd: disabled intentionally — Platform.isMacOS branching is on-purpose
      "obsidianmd/platform": "off",

      // Bundled by obsidianmd/recommended via tseslint.configs.recommendedTypeChecked.
      // Disabled here because the codebase intentionally uses `any` / dynamic typing
      // around Obsidian's untyped APIs and LangChain message shapes — flipping these
      // on would require refactoring thousands of call sites with no functional gain.
      //
      // Violation counts (src/**/*.{ts,tsx}) are noted inline. Rules with low counts
      // are candidates to enable in small follow-up PRs.

      // --- Heavy: any-flow through Obsidian/LangChain APIs ---
      "@typescript-eslint/no-unsafe-member-access": "off", // 2040 violations
      "@typescript-eslint/no-unsafe-assignment": "off", // 879 violations
      "@typescript-eslint/no-unsafe-call": "off", // 679 violations
      "@typescript-eslint/no-unsafe-argument": "off", // 368 violations
      "@typescript-eslint/no-unsafe-return": "off", // 187 violations

      // --- Medium: promise / method ergonomics ---
      "@typescript-eslint/unbound-method": "off", // 68 violations
      "@typescript-eslint/no-misused-promises": "off", // 46 violations
      "@typescript-eslint/no-unnecessary-type-assertion": "off", // 40 violations
      "@typescript-eslint/no-floating-promises": "off", // 39 violations
      "@typescript-eslint/await-thenable": "off", // 20 violations

      // --- Quick wins: small enough to fix and enable in a single PR ---
      "@typescript-eslint/no-unsafe-enum-comparison": "off", // 11 violations
      "@typescript-eslint/no-base-to-string": "off", // 7 violations
      "@typescript-eslint/no-redundant-type-constituents": "off", // 5 violations
      "@typescript-eslint/restrict-template-expressions": "off", // 1 violation
      // no-deprecated: defer — surface the warnings, but don't fail CI yet
      "@typescript-eslint/no-deprecated": "off",

      // SDL / import / no-unsanitized / depend: defer — review separately
      "no-restricted-globals": "off",
    },
  },

  // Test files need Jest globals
  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "jest.setup.js", "__mocks__/**"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },

  // Integration tests bootstrap jsdom fetch via `node-fetch` polyfill —
  // allow the otherwise-banned import here only.
  {
    files: ["src/integration_tests/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Node-context files (build configs, scripts)
  {
    files: [
      "*.{js,mjs,cjs}",
      "scripts/**",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "wasmPlugin.mjs",
      "nodeModuleShim.mjs",
      "jest.config.js",
      "tailwind.config.js",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },

  // TypeScript-specific overrides (the @typescript-eslint plugin is registered
  // by obsidianmd's recommended config only for .ts/.tsx files).
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      // TypeScript handles undefined-identifier detection (and does so cross-realm
      // correctly); per typescript-eslint's own guidance, disable no-undef on TS.
      "no-undef": "off",
    },
  },

  // Non-TS files aren't in tsconfig.json — disable type-aware rules that
  // obsidianmd's recommended config enables globally. (The plugin lists some
  // typed rules in its general rule bundle, not just the TS-only bundle, so
  // they cascade to .js / package.json without parser services.)
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx", "**/package.json"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/no-plugin-as-component": "off",
      "obsidianmd/no-view-references-in-plugin": "off",
      "obsidianmd/no-unsupported-api": "off",
      "obsidianmd/prefer-file-manager-trash-file": "off",
      "obsidianmd/prefer-instanceof": "off",
    },
  },

  // package.json: keep depend/ban-dependencies enabled (from obsidianmd
  // recommended) but allow the deps we deliberately keep.
  {
    files: ["**/package.json"],
    rules: {
      "depend/ban-dependencies": [
        "error",
        {
          presets: ["native", "microutilities", "preferred"],
          allowed: [
            "crypto-js",
            "dotenv",
            "js-yaml",
            "lodash.debounce",
            "eslint-plugin-react",
            "lint-staged",
            "npm-run-all",
          ],
        },
      ],
    },
  },

  // logger.ts is the central logging utility and must call console.* directly.
  // scripts/** are CLI tools that print to stdout.
  {
    files: ["src/logger.ts", "scripts/**"],
    rules: {
      "obsidianmd/rule-custom-message": "off",
    },
  },
];
